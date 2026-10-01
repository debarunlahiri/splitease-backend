package com.splitease.group.domain;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;

@Entity
@Table(name = "expense_groups")
public class ExpenseGroup {
    @Id
    private UUID id;
    @Column(nullable = false, length = 120)
    private String name;
    @Column(nullable = false, length = 3)
    private String defaultCurrency;
    @Column(nullable = false)
    private UUID createdBy;
    @Column(nullable = false, updatable = false)
    private Instant createdAt;
    @OneToMany(mappedBy = "group", cascade = CascadeType.ALL, orphanRemoval = true, fetch = FetchType.LAZY)
    private List<GroupMember> members = new ArrayList<>();

    protected ExpenseGroup() {
    }

    public ExpenseGroup(String name, String defaultCurrency, UUID createdBy) {
        this.id = UUID.randomUUID();
        this.name = name.trim();
        this.defaultCurrency = defaultCurrency.toUpperCase();
        this.createdBy = createdBy;
        this.createdAt = Instant.now();
        addMember(createdBy, "OWNER");
    }

    public void addMember(UUID userId, String role) {
        if (members.stream().noneMatch(member -> member.getUserId().equals(userId))) {
            members.add(new GroupMember(this, userId, role));
        }
    }

    public boolean contains(UUID userId) { return members.stream().anyMatch(m -> m.getUserId().equals(userId)); }
    public UUID getId() { return id; }
    public String getName() { return name; }
    public String getDefaultCurrency() { return defaultCurrency; }
    public UUID getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
    public List<GroupMember> getMembers() { return List.copyOf(members); }
}
