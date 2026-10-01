package com.splitease.group.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.splitease.group.domain.GroupInvitation;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface GroupInvitationRepository extends JpaRepository<GroupInvitation, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select invitation from GroupInvitation invitation where invitation.id = :id")
    Optional<GroupInvitation> findLockedById(@Param("id") UUID id);

    List<GroupInvitation> findByInviteeUserIdOrderByCreatedAtDesc(UUID inviteeUserId);

    List<GroupInvitation> findByGroupIdOrderByCreatedAtDesc(UUID groupId);

    Optional<GroupInvitation> findByGroupIdAndInviteeUserIdAndStatus(
            UUID groupId, UUID inviteeUserId, String status);
}
