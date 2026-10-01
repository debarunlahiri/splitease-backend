package com.splitease.group.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class GroupDtos {
    private GroupDtos() {
    }

    public record Create(
            @NotBlank @Size(max = 120) String name,
            @Pattern(regexp = "[A-Za-z]{3}") String defaultCurrency) {
    }

    public record Invite(@NotNull UUID userId) {
    }

    public record InvitationView(
            UUID id,
            UUID groupId,
            UUID inviteeUserId,
            UUID invitedBy,
            String status,
            Instant createdAt,
            Instant expiresAt,
            Instant respondedAt) {
    }

    public record Member(UUID userId, String role, Instant joinedAt) {
    }

    public record View(UUID id, String name, String defaultCurrency, UUID createdBy,
                       Instant createdAt, List<Member> members) {
    }
}
