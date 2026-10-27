package com.splitease.group.service;

import com.splitease.common.exception.ConflictException;
import com.splitease.common.exception.NotFoundException;
import com.splitease.group.domain.GroupInviteLink;
import com.splitease.group.dto.GroupDtos;
import com.splitease.group.repository.ExpenseGroupRepository;
import com.splitease.group.repository.GroupInviteLinkRepository;

import jakarta.persistence.EntityManager;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;

@Service
public class GroupInviteLinkService {
    private final ExpenseGroupRepository groups;
    private final GroupInviteLinkRepository links;
    private final EntityManager entityManager;
    private final SecureRandom random = new SecureRandom();

    public GroupInviteLinkService(
            ExpenseGroupRepository groups,
            GroupInviteLinkRepository links,
            EntityManager entityManager) {
        this.groups = groups;
        this.links = links;
        this.entityManager = entityManager;
    }

    @Transactional
    public GroupDtos.InviteLink create(UUID userId, UUID groupId) {
        var group =
                groups.findById(groupId)
                        .orElseThrow(() -> new NotFoundException("Group not found"));
        if (!group.getCreatedBy().equals(userId)) {
            throw new AccessDeniedException("Only the group owner can create invite links");
        }
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expiresAt = Instant.now().plus(Duration.ofDays(7));
        links.save(new GroupInviteLink(groupId, hash(token), expiresAt));
        return new GroupDtos.InviteLink(token, expiresAt);
    }

    @Transactional
    public GroupDtos.JoinedGroup join(UUID userId, String token) {
        var link =
                links.findByTokenHash(hash(token))
                        .orElseThrow(() -> new NotFoundException("Invite link not found"));
        entityManager
                .createNativeQuery("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))")
                .setParameter("key", "group-invitations:" + link.getGroupId())
                .getSingleResult();
        if (!link.getExpiresAt().isAfter(Instant.now())) {
            throw new ConflictException("Invite link has expired");
        }
        var group =
                groups.findById(link.getGroupId())
                        .orElseThrow(() -> new NotFoundException("Group not found"));
        // Reopening a link is safe; membership is unique per group and user.
        group.addMember(userId, "MEMBER");
        return new GroupDtos.JoinedGroup(group.getId());
    }

    private String hash(String token) {
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
