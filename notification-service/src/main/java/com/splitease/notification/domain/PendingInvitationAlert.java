package com.splitease.notification.domain;

import jakarta.persistence.*;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "pending_invitation_alerts")
public class PendingInvitationAlert {
    @Id private UUID eventId;

    @Column(nullable = false, length = 320)
    private String email;

    @Column(nullable = false)
    private UUID groupId;

    @Column(nullable = false)
    private UUID invitationId;

    @Column(nullable = false, length = 120)
    private String groupName;

    @Column(nullable = false)
    private Instant expiresAt;

    private UUID deliveredTo;

    protected PendingInvitationAlert() {}

    public PendingInvitationAlert(com.splitease.common.event.InvitationCreatedEvent event) {
        eventId = event.eventId();
        email = event.inviteeEmail();
        groupId = event.groupId();
        invitationId = event.invitationId();
        groupName = event.groupName();
        expiresAt = event.expiresAt();
    }

    public UUID getEventId() {
        return eventId;
    }

    public UUID getGroupId() {
        return groupId;
    }

    public UUID getInvitationId() {
        return invitationId;
    }

    public String getGroupName() {
        return groupName;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public void delivered(UUID userId) {
        deliveredTo = userId;
    }
}
