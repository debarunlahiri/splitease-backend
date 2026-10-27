package com.splitease.group.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class GroupDtos {
    private GroupDtos() {}

    public record Create(
            @NotBlank @Size(max = 120) String name,
            @Pattern(regexp = "[A-Za-z]{3}") String defaultCurrency) {}

    public record InviteLink(String token, Instant expiresAt) {}

    public record JoinLink(@NotBlank @Pattern(regexp = "[A-Za-z0-9_-]{43}") String token) {}

    public record JoinedGroup(UUID groupId) {}

    public record Invite(@NotBlank @Email @Size(max = 320) String email) {}

    public record InvitationView(
            UUID id,
            UUID groupId,
            UUID inviteeUserId,
            UUID invitedBy,
            String status,
            Instant createdAt,
            Instant expiresAt,
            Instant respondedAt,
            String inviteeEmail) {}

    public record Member(UUID userId, String role, Instant joinedAt, String displayName) {}

    public record View(
            UUID id,
            String name,
            String defaultCurrency,
            UUID createdBy,
            Instant createdAt,
            List<Member> members) {}
}
