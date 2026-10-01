package com.splitease.group.repository;

import java.util.Optional;
import java.util.UUID;

import com.splitease.group.domain.GroupInvitation;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface GroupInvitationRepository extends JpaRepository<GroupInvitation, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select invitation from GroupInvitation invitation where invitation.id = :id")
    Optional<GroupInvitation> findLockedById(@Param("id") UUID id);

    Page<GroupInvitation> findByInviteeUserId(UUID inviteeUserId, Pageable pageable);

    Page<GroupInvitation> findByGroupId(UUID groupId, Pageable pageable);

    Optional<GroupInvitation> findByGroupIdAndInviteeUserIdAndStatus(
            UUID groupId, UUID inviteeUserId, String status);
}
