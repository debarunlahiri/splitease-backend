package com.splitease.group.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "group_invite_links")
public class GroupInviteLink {
    @Id private UUID id;

    @Column(nullable = false)
    private UUID groupId;

    @Column(nullable = false, unique = true, length = 64)
    private String tokenHash;

    @Column(nullable = false)
    private Instant expiresAt;

    protected GroupInviteLink() {}

    public GroupInviteLink(UUID groupId, String tokenHash, Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.groupId = groupId;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
    }

    public UUID getGroupId() {
        return groupId;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }
}
