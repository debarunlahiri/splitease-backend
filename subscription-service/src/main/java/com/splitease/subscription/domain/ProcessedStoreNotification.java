package com.splitease.subscription.domain;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "processed_store_notifications")
public class ProcessedStoreNotification {
    @Id private UUID notificationId;
    @Column(nullable = false, length = 30) private String provider;
    @Column(nullable = false, updatable = false) private Instant processedAt;

    protected ProcessedStoreNotification() {
    }

    public ProcessedStoreNotification(UUID notificationId, StoreProvider provider) {
        this.notificationId = notificationId;
        this.provider = provider.name();
        this.processedAt = Instant.now();
    }
}

