package com.splitease.common.event;

import java.time.Instant;
import java.util.UUID;

public record InvitationCreatedEvent(
        UUID eventId,
        UUID invitationId,
        UUID groupId,
        String groupName,
        String inviteeEmail,
        UUID invitedBy,
        Instant expiresAt,
        Instant occurredAt) {}
