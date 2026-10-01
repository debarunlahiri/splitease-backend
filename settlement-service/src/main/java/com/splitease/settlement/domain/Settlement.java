package com.splitease.settlement.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "settlements")
public class Settlement {
    @Id private UUID id;
    @Column(nullable = false) private UUID groupId;
    @Column(nullable = false) private UUID payerId;
    @Column(nullable = false) private UUID payeeId;
    @Column(nullable = false, precision = 19, scale = 2) private BigDecimal amount;
    @Column(nullable = false, length = 3) private String currency;
    @Column(length = 160) private String note;
    @Column(nullable = false, updatable = false) private Instant createdAt;

    protected Settlement() {
    }

    public Settlement(UUID groupId, UUID payerId, UUID payeeId, BigDecimal amount, String currency, String note) {
        this.id = UUID.randomUUID();
        this.groupId = groupId;
        this.payerId = payerId;
        this.payeeId = payeeId;
        this.amount = amount;
        this.currency = currency.toUpperCase();
        this.note = note;
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getGroupId() { return groupId; }
    public UUID getPayerId() { return payerId; }
    public UUID getPayeeId() { return payeeId; }
    public BigDecimal getAmount() { return amount; }
    public String getCurrency() { return currency; }
    public String getNote() { return note; }
    public Instant getCreatedAt() { return createdAt; }
}

