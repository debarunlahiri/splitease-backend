package com.splitease.identity.domain;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "login_throttles")
public class LoginThrottle {
    @Id
    @Column(length = 64)
    private String subjectHash;
    @Column(nullable = false)
    private int failedAttempts;
    @Column(nullable = false)
    private Instant windowStartedAt;
    private Instant blockedUntil;

    protected LoginThrottle() {
    }

    public LoginThrottle(String subjectHash, Instant now) {
        this.subjectHash = subjectHash;
        this.windowStartedAt = now;
    }

    public int getFailedAttempts() {
        return failedAttempts;
    }

    public Instant getWindowStartedAt() {
        return windowStartedAt;
    }

    public Instant getBlockedUntil() {
        return blockedUntil;
    }

    public void reset(Instant now) {
        failedAttempts = 0;
        windowStartedAt = now;
        blockedUntil = null;
    }

    public void recordFailure(Instant now, int maximumAttempts, Instant newBlockedUntil) {
        failedAttempts++;
        if (failedAttempts >= maximumAttempts) {
            blockedUntil = newBlockedUntil;
        }
    }
}
