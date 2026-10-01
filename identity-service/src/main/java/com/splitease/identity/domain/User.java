package com.splitease.identity.domain;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "users")
public class User {
    @Id
    private UUID id;
    @Column(nullable = false, unique = true, length = 320)
    private String email;
    @Column(nullable = false, length = 100)
    private String displayName;
    @Column(nullable = false)
    private String passwordHash;
    @Column(nullable = false, updatable = false)
    private Instant createdAt;
    private Instant emailVerifiedAt;

    protected User() {
    }

    public User(String email, String displayName, String passwordHash) {
        this.id = UUID.randomUUID();
        this.email = email.trim().toLowerCase();
        this.displayName = displayName.trim();
        this.passwordHash = passwordHash;
        this.createdAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public String getEmail() {
        return email;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public boolean isEmailVerified() {
        return emailVerifiedAt != null;
    }

    public void verifyEmail(Instant verifiedAt) {
        this.emailVerifiedAt = verifiedAt;
    }
}
