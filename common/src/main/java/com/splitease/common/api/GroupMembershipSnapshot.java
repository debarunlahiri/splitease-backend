package com.splitease.common.api;

import java.util.Set;
import java.util.UUID;

public record GroupMembershipSnapshot(UUID groupId, Set<UUID> memberIds) {
    public GroupMembershipSnapshot {
        memberIds = Set.copyOf(memberIds);
    }

    public boolean contains(UUID userId) {
        return memberIds.contains(userId);
    }
}

