package com.splitease.group.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.splitease.common.exception.ConflictException;
import com.splitease.common.exception.NotFoundException;
import com.splitease.group.domain.ExpenseGroup;
import com.splitease.group.domain.GroupInviteLink;
import com.splitease.group.repository.ExpenseGroupRepository;
import com.splitease.group.repository.GroupInviteLinkRepository;

import jakarta.persistence.EntityManager;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

class GroupInviteLinkServiceTest {
    private final ExpenseGroupRepository groups = mock(ExpenseGroupRepository.class);
    private final GroupInviteLinkRepository links = mock(GroupInviteLinkRepository.class);
    private final EntityManager entityManager = mock(EntityManager.class, RETURNS_DEEP_STUBS);
    private final UUID owner = UUID.randomUUID();
    private final ExpenseGroup group = new ExpenseGroup("Trip", "INR", owner);
    private final GroupInviteLinkService service =
            new GroupInviteLinkService(groups, links, entityManager);

    @BeforeEach
    void prepare() {
        when(groups.findById(group.getId())).thenReturn(Optional.of(group));
    }

    @Test
    void ownerCanCreateAnUnguessableExpiringLink() {
        var link = service.create(owner, group.getId());
        assertTrue(link.token().matches("[A-Za-z0-9_-]{43}"));
        assertTrue(link.expiresAt().isAfter(Instant.now()));
        verify(links).save(any(GroupInviteLink.class));
    }

    @Test
    void memberCannotCreateLinks() {
        UUID member = UUID.randomUUID();
        group.addMember(member, "MEMBER");
        assertThrows(AccessDeniedException.class, () -> service.create(member, group.getId()));
        verify(links, never()).save(any());
    }

    @Test
    void validLinkJoinsMultipleUsersAndRepeatOpenDoesNotDuplicateMembership() {
        when(links.findByTokenHash(anyString()))
                .thenReturn(
                        Optional.of(
                                new GroupInviteLink(
                                        group.getId(), "hash", Instant.now().plusSeconds(3600))));
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        assertEquals(group.getId(), service.join(first, "token").groupId());
        service.join(first, "token");
        service.join(second, "token");
        assertTrue(group.contains(first));
        assertTrue(group.contains(second));
        assertEquals(3, group.getMembers().size());
    }

    @Test
    void expiredLinkDoesNotAddMember() {
        when(links.findByTokenHash(anyString()))
                .thenReturn(
                        Optional.of(
                                new GroupInviteLink(
                                        group.getId(), "hash", Instant.now().minusSeconds(1))));
        UUID user = UUID.randomUUID();
        assertThrows(ConflictException.class, () -> service.join(user, "token"));
        assertFalse(group.contains(user));
    }

    @Test
    void unknownLinkDoesNotAddMember() {
        when(links.findByTokenHash(anyString())).thenReturn(Optional.empty());
        assertThrows(NotFoundException.class, () -> service.join(UUID.randomUUID(), "unknown"));
        assertEquals(1, group.getMembers().size());
    }
}
