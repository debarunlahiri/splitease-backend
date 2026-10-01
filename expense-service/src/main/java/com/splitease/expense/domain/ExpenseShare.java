package com.splitease.expense.domain;

import java.math.BigDecimal;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;

@Entity
@Table(name = "expense_shares")
public class ExpenseShare {
    @Id private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false) @JoinColumn(name = "expense_id") private Expense expense;
    @Column(nullable = false) private UUID userId;
    @Column(nullable = false, precision = 19, scale = 2) private BigDecimal amount;

    protected ExpenseShare() {
    }

    ExpenseShare(Expense expense, UUID userId, BigDecimal amount) {
        this.id = UUID.randomUUID();
        this.expense = expense;
        this.userId = userId;
        this.amount = amount;
    }

    public UUID getUserId() { return userId; }
    public BigDecimal getAmount() { return amount; }
}

