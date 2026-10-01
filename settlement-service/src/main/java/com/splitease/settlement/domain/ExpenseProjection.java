package com.splitease.settlement.domain;

import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "expense_projections")
public class ExpenseProjection {
    @Id
    private UUID expenseId;
    @Column(nullable = false)
    private UUID groupId;
    @Column(nullable = false)
    private long revision;
    @Column(columnDefinition = "text")
    private String snapshot;

    protected ExpenseProjection() {
    }

    public ExpenseProjection(UUID expenseId, UUID groupId, long revision, String snapshot) {
        this.expenseId = expenseId;
        this.groupId = groupId;
        this.revision = revision;
        this.snapshot = snapshot;
    }

    public long getRevision() { return revision; }
    public String getSnapshot() { return snapshot; }

    public void replace(long revision, String snapshot) {
        this.revision = revision;
        this.snapshot = snapshot;
    }
}
