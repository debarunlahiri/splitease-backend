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
    @Column(length = 80) private String category;
    @Column(length = 2000) private String notes;
    @Column(length = 255) private String receiptName;
    @Column(length = 120) private String receiptContentType;
    @Column(length = 500) private String receiptStorageKey;
    private Instant updatedAt;
    private Instant deletedAt;
    @Column(nullable = false) private long revision;
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
    public void setMetadata(String category, String notes, String receiptName,
                            String receiptContentType, String receiptStorageKey) {
        this.category = category;
        this.notes = notes;
        this.receiptName = receiptName;
        this.receiptContentType = receiptContentType;
        this.receiptStorageKey = receiptStorageKey;
    }

    public void edit(UUID paidBy, String description, BigDecimal amount, String currency,
                     LocalDate expenseDate, SplitType splitType) {
        this.paidBy = paidBy;
        this.description = description.trim();
        this.amount = amount;
        this.currency = currency.toUpperCase();
        this.expenseDate = expenseDate;
        this.splitType = splitType;
        this.updatedAt = Instant.now();
        this.revision++;
        shares.clear();
    }

    public void delete() {
        this.deletedAt = Instant.now();
        this.updatedAt = deletedAt;
        this.revision++;
    }

    public String getCategory() { return category; }
    public String getNotes() { return notes; }
    public String getReceiptName() { return receiptName; }
    public String getReceiptContentType() { return receiptContentType; }
    public String getReceiptStorageKey() { return receiptStorageKey; }
    public Instant getUpdatedAt() { return updatedAt; }
    public Instant getDeletedAt() { return deletedAt; }
    public long getRevision() { return revision; }
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
