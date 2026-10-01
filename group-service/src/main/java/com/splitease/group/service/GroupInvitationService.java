package com.splitease.group.service;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.splitease.common.exception.ConflictException;
import com.splitease.common.exception.NotFoundException;
import com.splitease.group.domain.ExpenseGroup;
import com.splitease.group.domain.GroupInvitation;
import com.splitease.group.dto.GroupDtos;
import com.splitease.group.repository.ExpenseGroupRepository;
import com.splitease.group.repository.GroupInvitationRepository;
import jakarta.persistence.EntityManager;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GroupInvitationService {
    private final ExpenseGroupRepository groups;
    private final GroupInvitationRepository invitations;
    private final EntityManager entityManager;
    private final Duration lifetime;

    public GroupInvitationService(
            ExpenseGroupRepository groups,
            GroupInvitationRepository invitations,
            EntityManager entityManager,
            @Value("${groups.invitation-lifetime:P7D}") Duration lifetime) {
        this.groups = groups;
        this.invitations = invitations;
        this.entityManager = entityManager;
        this.lifetime = lifetime;
    }

    @Transactional
    public GroupDtos.InvitationView create(UUID ownerId, UUID groupId, GroupDtos.Invite request) {
        lockGroup(groupId);
        ExpenseGroup group = requiredGroup(groupId);
        requireOwner(group, ownerId);
        if (group.contains(request.userId())) {
            throw new ConflictException("User is already a group member");
        }
        invitations.findByGroupIdAndInviteeUserIdAndStatus(groupId, request.userId(), "PENDING")
                .ifPresent(existing -> {
                    if (!existing.expireIfNeeded(Instant.now())) {
                        throw new ConflictException("A pending invitation already exists");
                    }
                });
        invitations.flush();
        GroupInvitation invitation = invitations.save(new GroupInvitation(
                groupId, request.userId(), ownerId, Instant.now().plus(lifetime)));
        return view(invitation);
    }

    @Transactional
    public List<GroupDtos.InvitationView> inbox(UUID userId) {
        return invitations.findByInviteeUserIdOrderByCreatedAtDesc(userId).stream()
                .map(invitation -> {
                    invitation.expireIfNeeded(Instant.now());
                    return view(invitation);
                })
                .toList();
    }

    @Transactional
    public List<GroupDtos.InvitationView> forGroup(UUID ownerId, UUID groupId) {
        requireOwner(requiredGroup(groupId), ownerId);
        return invitations.findByGroupIdOrderByCreatedAtDesc(groupId).stream()
                .map(invitation -> {
                    invitation.expireIfNeeded(Instant.now());
                    return view(invitation);
                })
                .toList();
    }

    @Transactional(noRollbackFor = ConflictException.class)
    public GroupDtos.InvitationView accept(UUID userId, UUID invitationId) {
        GroupInvitation invitation = requiredInvitation(invitationId);
        requireInvitee(invitation, userId);
        requirePending(invitation);
        ExpenseGroup group = requiredGroup(invitation.getGroupId());
        if (group.contains(userId)) {
            throw new ConflictException("User is already a group member");
        }
        group.addMember(userId, "MEMBER");
        invitation.accept(Instant.now());
        return view(invitation);
    }

    @Transactional(noRollbackFor = ConflictException.class)
    public GroupDtos.InvitationView decline(UUID userId, UUID invitationId) {
        GroupInvitation invitation = requiredInvitation(invitationId);
        requireInvitee(invitation, userId);
        requirePending(invitation);
        invitation.decline(Instant.now());
        return view(invitation);
    }

    @Transactional(noRollbackFor = ConflictException.class)
    public GroupDtos.InvitationView revoke(UUID ownerId, UUID invitationId) {
        GroupInvitation invitation = requiredInvitation(invitationId);
        requireOwner(requiredGroup(invitation.getGroupId()), ownerId);
        requirePending(invitation);
        invitation.revoke(Instant.now());
        return view(invitation);
    }

    private ExpenseGroup requiredGroup(UUID groupId) {
        return groups.findById(groupId)
                .orElseThrow(() -> new NotFoundException("Group not found"));
    }

    private GroupInvitation requiredInvitation(UUID invitationId) {
        GroupInvitation current = invitations.findById(invitationId)
                .orElseThrow(() -> new NotFoundException("Invitation not found"));
        lockGroup(current.getGroupId());
        return invitations.findLockedById(invitationId)
                .orElseThrow(() -> new NotFoundException("Invitation not found"));
    }

    private void lockGroup(UUID groupId) {
        entityManager.createNativeQuery("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))")
                .setParameter("key", "group-invitations:" + groupId)
                .getSingleResult();
    }

    private void requireOwner(ExpenseGroup group, UUID userId) {
        if (!group.getCreatedBy().equals(userId)) {
            throw new AccessDeniedException("Only the group owner can manage invitations");
        }
    }

    private void requireInvitee(GroupInvitation invitation, UUID userId) {
        if (!invitation.getInviteeUserId().equals(userId)) {
            throw new AccessDeniedException("Only the invited user can respond");
        }
    }

    private void requirePending(GroupInvitation invitation) {
        if (invitation.expireIfNeeded(Instant.now())) {
            throw new ConflictException("Invitation has expired");
        }
        if (!"PENDING".equals(invitation.getStatus())) {
            throw new ConflictException("Invitation is no longer pending");
        }
    }

    private GroupDtos.InvitationView view(GroupInvitation invitation) {
        return new GroupDtos.InvitationView(invitation.getId(), invitation.getGroupId(),
                invitation.getInviteeUserId(), invitation.getInvitedBy(), invitation.getStatus(),
                invitation.getCreatedAt(), invitation.getExpiresAt(), invitation.getRespondedAt());
    }
}
