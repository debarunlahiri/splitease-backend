package com.splitease.group.domain;

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
@Table(name = "group_members")
public class GroupMember {
    @Id
    private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "group_id", nullable = false)
    private ExpenseGroup group;
    @Column(nullable = false)
    private UUID userId;
    @Column(nullable = false, length = 20)
    private String role;
    @Column(nullable = false, updatable = false)
    private Instant joinedAt;

    protected GroupMember() {
    }

    GroupMember(ExpenseGroup group, UUID userId, String role) {
        this.id = UUID.randomUUID();
        this.group = group;
        this.userId = userId;
        this.role = role;
        this.joinedAt = Instant.now();
    }

    public UUID getUserId() { return userId; }
    public String getRole() { return role; }
    public Instant getJoinedAt() { return joinedAt; }
}

