package com.splitease.group.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "group_invitations")
public class GroupInvitation {
    @Id private UUID id;

    @Column(nullable = false)
    private UUID groupId;

    private UUID inviteeUserId;

    @Column(length = 320)
    private String inviteeEmail;

    @Column(nullable = false)
    private UUID invitedBy;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant expiresAt;

    private Instant respondedAt;
    @Version private long version;

    protected GroupInvitation() {}

    public GroupInvitation(UUID groupId, String inviteeEmail, UUID invitedBy, Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.groupId = groupId;
        this.inviteeEmail = inviteeEmail;
        this.invitedBy = invitedBy;
        this.status = "PENDING";
        this.createdAt = Instant.now();
        this.expiresAt = expiresAt;
    }

    public String getInviteeEmail() {
        return inviteeEmail;
    }

    public void bindRecipient(UUID userId) {
        this.inviteeUserId = userId;
    }

    public UUID getId() {
        return id;
    }

    public UUID getGroupId() {
        return groupId;
    }

    public UUID getInviteeUserId() {
        return inviteeUserId;
    }

    public UUID getInvitedBy() {
        return invitedBy;
    }

    public String getStatus() {
        return status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getRespondedAt() {
        return respondedAt;
    }

    public boolean expireIfNeeded(Instant now) {
        if ("PENDING".equals(status) && !expiresAt.isAfter(now)) {
            status = "EXPIRED";
            respondedAt = now;
            return true;
        }
        return false;
    }

    public void accept(Instant now) {
        status = "ACCEPTED";
        respondedAt = now;
    }

    public void decline(Instant now) {
        status = "DECLINED";
        respondedAt = now;
    }

    public void revoke(Instant now) {
        status = "REVOKED";
        respondedAt = now;
    }
}
