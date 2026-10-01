package com.splitease.identity.service;

import java.time.Duration;
import java.time.Instant;

import com.splitease.common.exception.TooManyRequestsException;
import com.splitease.identity.domain.LoginThrottle;
import com.splitease.identity.repository.LoginThrottleRepository;
import jakarta.persistence.EntityManager;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LoginThrottleService {
    private final LoginThrottleRepository throttles;
    private final SecureTokenCodec tokenCodec;
    private final EntityManager entityManager;
    private final int maximumAttempts;
    private final Duration attemptWindow;
    private final Duration blockDuration;

    public LoginThrottleService(
            LoginThrottleRepository throttles,
            SecureTokenCodec tokenCodec,
            EntityManager entityManager,
            @Value("${security.login-throttle.maximum-attempts:5}") int maximumAttempts,
            @Value("${security.login-throttle.attempt-window:PT15M}") Duration attemptWindow,
            @Value("${security.login-throttle.block-duration:PT15M}") Duration blockDuration) {
        this.throttles = throttles;
        this.tokenCodec = tokenCodec;
        this.entityManager = entityManager;
        this.maximumAttempts = maximumAttempts;
        this.attemptWindow = attemptWindow;
        this.blockDuration = blockDuration;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void checkAllowed(String email) {
        LoginThrottle throttle = lockedThrottle(email);
        Instant now = Instant.now();
        resetExpiredWindow(throttle, now);
        if (throttle.getBlockedUntil() != null && throttle.getBlockedUntil().isAfter(now)) {
            throw new TooManyRequestsException("Too many login attempts. Try again later");
        }
        throttles.save(throttle);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordFailure(String email) {
        LoginThrottle throttle = lockedThrottle(email);
        Instant now = Instant.now();
        resetExpiredWindow(throttle, now);
        throttle.recordFailure(now, maximumAttempts, now.plus(blockDuration));
        throttles.save(throttle);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordSuccess(String email) {
        LoginThrottle throttle = lockedThrottle(email);
        throttle.reset(Instant.now());
        throttles.save(throttle);
    }

    private LoginThrottle lockedThrottle(String email) {
        String subjectHash = tokenCodec.hash(email.trim().toLowerCase());
        entityManager.createNativeQuery("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))")
                .setParameter("key", "login:" + subjectHash)
                .getSingleResult();
        return throttles.findById(subjectHash)
                .orElseGet(() -> new LoginThrottle(subjectHash, Instant.now()));
    }

    private void resetExpiredWindow(LoginThrottle throttle, Instant now) {
        if (!throttle.getWindowStartedAt().plus(attemptWindow).isAfter(now)) {
            throttle.reset(now);
        }
    }
}
