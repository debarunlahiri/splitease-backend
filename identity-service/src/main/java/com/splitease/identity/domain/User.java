package com.splitease.identity.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "users")
public class User {
    @Id private UUID id;

    @Column(nullable = false, unique = true, length = 320)
    private String email;

    @Column(nullable = false, length = 100)
    private String displayName;

    @Column(nullable = false)
    private String passwordHash;

    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    private Instant emailVerifiedAt;

    @Column(unique = true, length = 128)
    private String firebaseUid;

    @Column(length = 2048)
    private String photoUrl;

    protected User() {}

    public User(String email, String displayName, String passwordHash) {
        this.id = UUID.randomUUID();
        this.email = email.trim().toLowerCase();
        this.displayName = displayName.trim();
        this.passwordHash = passwordHash;
        this.createdAt = Instant.now();
    }

    public String getFirebaseUid() {
        return firebaseUid;
    }

    public void linkFirebase(String uid) {
        this.firebaseUid = uid;
    }

    public String getPhotoUrl() {
        return photoUrl;
    }

    public void updatePhotoUrl(String value) {
        this.photoUrl = null;
        if (value == null || value.isBlank() || value.length() > 2048) {
            return;
        }
        try {
            java.net.URI uri = java.net.URI.create(value.trim());
            if ("https".equalsIgnoreCase(uri.getScheme())
                    && uri.getHost() != null
                    && uri.getUserInfo() == null) {
                this.photoUrl = uri.toString();
            }
        } catch (IllegalArgumentException ignored) {
            // Invalid/missing provider photos must not prevent authentication.
        }
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
