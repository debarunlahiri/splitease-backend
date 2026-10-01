package com.splitease.expense.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;

@Entity
@Table(name = "expenses")
public class Expense {
    @Id private UUID id;
    @Column(nullable = false) private UUID groupId;
    @Column(nullable = false) private UUID paidBy;
    @Column(nullable = false, length = 160) private String description;
    @Column(nullable = false, precision = 19, scale = 2) private BigDecimal amount;
    @Column(nullable = false, length = 3) private String currency;
    @Column(nullable = false) private LocalDate expenseDate;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20) private SplitType splitType;
    @Column(nullable = false, updatable = false) private Instant createdAt;
    @OneToMany(mappedBy = "expense", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    private List<ExpenseShare> shares = new ArrayList<>();

    protected Expense() {
    }

    public Expense(UUID groupId, UUID paidBy, String description, BigDecimal amount,
                   String currency, LocalDate expenseDate, SplitType splitType) {
        this.id = UUID.randomUUID();
        this.groupId = groupId;
        this.paidBy = paidBy;
        this.description = description.trim();
        this.amount = amount;
        this.currency = currency.toUpperCase();
        this.expenseDate = expenseDate;
        this.splitType = splitType;
        this.createdAt = Instant.now();
    }

    public void addShare(UUID userId, BigDecimal amount) { shares.add(new ExpenseShare(this, userId, amount)); }
    public UUID getId() { return id; }
    public UUID getGroupId() { return groupId; }
    public UUID getPaidBy() { return paidBy; }
    public String getDescription() { return description; }
    public BigDecimal getAmount() { return amount; }
    public String getCurrency() { return currency; }
    public LocalDate getExpenseDate() { return expenseDate; }
    public SplitType getSplitType() { return splitType; }
    public Instant getCreatedAt() { return createdAt; }
    public List<ExpenseShare> getShares() { return List.copyOf(shares); }
}

