package com.splitease.identity.domain;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "refresh_tokens")
public class RefreshToken {
    @Id
    private UUID id;
    @Column(nullable = false)
    private UUID userId;
    @Column(nullable = false)
    private UUID familyId;
    @Column(nullable = false, unique = true, length = 64)
    private String tokenHash;
    @Column(nullable = false)
    private Instant expiresAt;
    @Column(nullable = false, updatable = false)
    private Instant createdAt;
    private Instant consumedAt;
    private Instant revokedAt;
    private UUID replacedById;

    protected RefreshToken() {
    }

    public RefreshToken(UUID userId, UUID familyId, String tokenHash, Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.userId = userId;
        this.familyId = familyId;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
        this.createdAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public UUID getUserId() {
        return userId;
    }

    public UUID getFamilyId() {
        return familyId;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getConsumedAt() {
        return consumedAt;
    }

    public Instant getRevokedAt() {
        return revokedAt;
    }

    public void consume(Instant consumedAt, UUID replacementId) {
        this.consumedAt = consumedAt;
        this.replacedById = replacementId;
    }

    public void revoke(Instant revokedAt) {
        this.revokedAt = revokedAt;
    }
}
