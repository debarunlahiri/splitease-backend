package com.splitease.group.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.splitease.group.domain.ExpenseGroup;
import com.splitease.group.domain.GroupInvitation;
import com.splitease.group.dto.GroupDtos;
import com.splitease.group.repository.ExpenseGroupRepository;
import com.splitease.group.repository.GroupInvitationRepository;

import jakarta.persistence.EntityManager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

class GroupInvitationServiceTest {
    private final ExpenseGroupRepository groups = mock(ExpenseGroupRepository.class);
    private final GroupInvitationRepository invitations = mock(GroupInvitationRepository.class);
    private final EntityManager entityManager = mock(EntityManager.class, RETURNS_DEEP_STUBS);
    private final UUID owner = UUID.randomUUID();
    private final ExpenseGroup group = new ExpenseGroup("Trip", "INR", owner);
    private final GroupInvitationService service =
            new GroupInvitationService(
                    groups,
                    invitations,
                    entityManager,
                    mock(OutboxService.class),
                    Duration.ofDays(7));

    @BeforeEach
    void prepare() {
        when(groups.findById(group.getId())).thenReturn(Optional.of(group));
    }

    @Test
    void createsEmailInvitationWithoutExistingUserLookup() {
        when(invitations.findByGroupIdAndInviteeEmailAndStatus(any(), any(), any()))
                .thenReturn(Optional.empty());
        when(invitations.save(any())).thenAnswer(call -> call.getArgument(0));
        var result =
                service.create(
                        owner,
                        "owner@example.com",
                        group.getId(),
                        new GroupDtos.Invite("Friend@Example.com"));
        assertEquals("friend@example.com", result.inviteeEmail());
        assertNull(result.inviteeUserId());
        assertEquals("PENDING", result.status());
    }

    @Test
    void matchingAuthenticatedEmailCanAcceptAndBindsUserId() {
        GroupInvitation invitation = pending("friend@example.com");
        UUID recipient = UUID.randomUUID();
        var result = service.accept(recipient, "FRIEND@example.com", invitation.getId());
        assertEquals("ACCEPTED", result.status());
        assertEquals(recipient, result.inviteeUserId());
        assertTrue(group.contains(recipient));
    }

    @Test
    void anotherEmailCannotAccept() {
        GroupInvitation invitation = pending("friend@example.com");
        UUID stranger = UUID.randomUUID();
        assertThrows(
                AccessDeniedException.class,
                () -> service.accept(stranger, "other@example.com", invitation.getId()));
        assertFalse(group.contains(stranger));
        assertEquals("PENDING", invitation.getStatus());
    }

    @Test
    void legacyUuidInviteCannotBeClaimedByEmail() {
        GroupInvitation invitation = pending("friend@example.com");
        UUID assigned = UUID.randomUUID();
        invitation.bindRecipient(assigned);
        assertThrows(
                AccessDeniedException.class,
                () -> service.accept(UUID.randomUUID(), "friend@example.com", invitation.getId()));
    }

    private GroupInvitation pending(String email) {
        GroupInvitation invitation =
                new GroupInvitation(
                        group.getId(), email, owner, Instant.now().plus(Duration.ofDays(1)));
        when(invitations.findById(invitation.getId())).thenReturn(Optional.of(invitation));
        when(invitations.findLockedById(invitation.getId())).thenReturn(Optional.of(invitation));
        return invitation;
    }
}
