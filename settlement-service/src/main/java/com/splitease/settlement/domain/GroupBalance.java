package com.splitease.settlement.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "group_balances")
public class GroupBalance {
    @Id private UUID id;
    @Column(nullable = false) private UUID groupId;
    @Column(nullable = false) private UUID userId;
    @Column(nullable = false, length = 3) private String currency;
    @Column(nullable = false, precision = 19, scale = 2) private BigDecimal amount;
    @Column(nullable = false) private Instant updatedAt;

    protected GroupBalance() {
    }

    public GroupBalance(UUID groupId, UUID userId, String currency) {
        this.id = UUID.randomUUID();
        this.groupId = groupId;
        this.userId = userId;
        this.currency = currency;
        this.amount = BigDecimal.ZERO.setScale(2);
        this.updatedAt = Instant.now();
    }

    public void adjust(BigDecimal delta) {
        this.amount = amount.add(delta);
        this.updatedAt = Instant.now();
    }

    public UUID getUserId() { return userId; }
    public BigDecimal getAmount() { return amount; }
    public String getCurrency() { return currency; }
    public Instant getUpdatedAt() { return updatedAt; }
}

