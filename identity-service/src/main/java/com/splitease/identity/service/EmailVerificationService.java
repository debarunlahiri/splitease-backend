package com.splitease.identity.service;

import java.time.Duration;
import java.time.Instant;

import com.splitease.identity.domain.EmailVerificationToken;
import com.splitease.identity.domain.User;
import com.splitease.identity.repository.EmailVerificationTokenRepository;
import com.splitease.identity.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EmailVerificationService {
    private final EmailVerificationTokenRepository tokens;
    private final UserRepository users;
    private final SecureTokenCodec tokenCodec;
    private final EmailVerificationSender sender;
    private final Duration lifetime;

    public EmailVerificationService(
            EmailVerificationTokenRepository tokens,
            UserRepository users,
            SecureTokenCodec tokenCodec,
            EmailVerificationSender sender,
            @Value("${security.email-verification.lifetime:PT24H}") Duration lifetime) {
        this.tokens = tokens;
        this.users = users;
        this.tokenCodec = tokenCodec;
        this.sender = sender;
        this.lifetime = lifetime;
    }

    @Transactional
    public void issue(User user) {
        tokens.deleteByUserId(user.getId());
        String rawToken = tokenCodec.generate();
        tokens.save(new EmailVerificationToken(
                user.getId(), tokenCodec.hash(rawToken), Instant.now().plus(lifetime)));
        sender.sendVerification(user.getEmail(), user.getDisplayName(), rawToken);
    }

    @Transactional
    public void verify(String rawToken) {
        Instant now = Instant.now();
        EmailVerificationToken token = tokens.findByTokenHash(tokenCodec.hash(rawToken))
                .orElseThrow(() -> new BadCredentialsException("Invalid email verification token"));
        if (token.getConsumedAt() != null || !token.getExpiresAt().isAfter(now)) {
            throw new BadCredentialsException("Email verification token is expired or already used");
        }
        User user = users.findById(token.getUserId())
                .orElseThrow(() -> new BadCredentialsException("Invalid email verification token"));
        user.verifyEmail(now);
        token.consume(now);
    }

    @Transactional
    public void resend(String email) {
        users.findByEmailIgnoreCase(email.trim().toLowerCase())
                .filter(user -> !user.isEmailVerified())
                .ifPresent(this::issue);
    }
}
