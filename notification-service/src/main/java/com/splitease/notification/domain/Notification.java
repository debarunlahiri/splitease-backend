package com.splitease.notification.domain;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "notifications")
public class Notification {
    @Id private UUID id;
    @Column(nullable = false) private UUID userId;
    @Column(nullable = false, length = 40) private String type;
    @Column(nullable = false, length = 140) private String title;
    @Column(nullable = false, length = 500) private String message;
    @Column(name = "is_read", nullable = false) private boolean read;
    @Column(nullable = false, updatable = false) private Instant createdAt;

    protected Notification() {
    }

    public Notification(UUID userId, String type, String title, String message) {
        this.id = UUID.randomUUID();
        this.userId = userId;
        this.type = type;
        this.title = title;
        this.message = message;
        this.createdAt = Instant.now();
    }

    public void markRead() { this.read = true; }
    public UUID getId() { return id; }
    public String getType() { return type; }
    public String getTitle() { return title; }
    public String getMessage() { return message; }
    public boolean isRead() { return read; }
    public Instant getCreatedAt() { return createdAt; }
}
