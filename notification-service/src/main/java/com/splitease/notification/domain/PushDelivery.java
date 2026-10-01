package com.splitease.notification.domain;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "push_deliveries")
public class PushDelivery {
    @Id
    private UUID id;
    @Column(nullable = false, unique = true)
    private UUID notificationId;
    @Column(nullable = false)
    private UUID userId;
    @Column(nullable = false)
    private Instant nextAttemptAt;
    @Column(nullable = false)
    private int attempts;
    private Instant deliveredAt;
    @Column(length = 500)
    private String lastError;

    protected PushDelivery() {
    }

    public PushDelivery(UUID notificationId, UUID userId) {
        this.id = UUID.randomUUID();
        this.notificationId = notificationId;
        this.userId = userId;
        this.nextAttemptAt = Instant.now();
    }

    public UUID getNotificationId() { return notificationId; }
    public UUID getUserId() { return userId; }

    public void delivered() {
        deliveredAt = Instant.now();
        lastError = null;
    }

    public void retry(String reason) {
        attempts++;
        lastError = reason == null ? "Push provider failed" : reason.substring(0, Math.min(reason.length(), 500));
        if (attempts >= 10) {
            nextAttemptAt = Instant.now().plusSeconds(365L * 24 * 60 * 60);
        } else {
            nextAttemptAt = Instant.now().plusSeconds(Math.min(3600, 1L << attempts));
        }
    }
}
