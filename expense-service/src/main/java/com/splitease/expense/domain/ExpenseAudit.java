package com.splitease.expense.domain;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "expense_audit")
public class ExpenseAudit {
    @Id
    private UUID id;
    @Column(nullable = false)
    private UUID expenseId;
    @Column(nullable = false)
    private UUID groupId;
    @Column(nullable = false)
    private UUID actorId;
    @Column(nullable = false, length = 20)
    private String action;
    @Column(nullable = false)
    private long revision;
    @Column(nullable = false, columnDefinition = "text")
    private String snapshot;
    @Column(nullable = false, updatable = false)
    private Instant occurredAt;

    protected ExpenseAudit() {
    }

    public ExpenseAudit(UUID expenseId, UUID groupId, UUID actorId, String action,
                        long revision, String snapshot) {
        this.id = UUID.randomUUID();
        this.expenseId = expenseId;
        this.groupId = groupId;
        this.actorId = actorId;
        this.action = action;
        this.revision = revision;
        this.snapshot = snapshot;
        this.occurredAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getActorId() { return actorId; }
    public String getAction() { return action; }
    public long getRevision() { return revision; }
    public String getSnapshot() { return snapshot; }
    public Instant getOccurredAt() { return occurredAt; }
}
