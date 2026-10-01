package com.splitease.subscription.domain;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

@Entity
@Table(name = "subscriptions")
public class Subscription {
    @Id private UUID id;
    @Column(nullable = false) private UUID userId;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "plan_id") private Plan plan;
    @Column(nullable = false, length = 20) private String status;
    @Column(nullable = false) private Instant startsAt;
    @Column(nullable = false) private Instant expiresAt;
    @Column(nullable = false, length = 30) private String provider;
    @Column(nullable = false, unique = true, length = 160) private String providerReference;

    protected Subscription() {
    }

    public Subscription(
            UUID userId,
            Plan plan,
            Instant startsAt,
            Instant expiresAt,
            StoreProvider provider,
            String providerReference) {
        this.id = UUID.randomUUID();
        this.userId = userId;
        this.plan = plan;
        this.status = "ACTIVE";
        this.startsAt = startsAt;
        this.expiresAt = expiresAt;
        this.provider = provider.name();
        this.providerReference = providerReference;
    }

    public UUID getUserId() { return userId; }
    public Plan getPlan() { return plan; }
    public String getStatus() { return status; }
    public Instant getExpiresAt() { return expiresAt; }

    public void applyVerification(Instant startsAt, Instant expiresAt, boolean active) {
        this.startsAt = startsAt;
        this.expiresAt = expiresAt;
        this.status = active ? "ACTIVE" : "INACTIVE";
    }
}
