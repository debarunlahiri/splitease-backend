package com.splitease.group.repository;

import com.splitease.group.domain.GroupInvitation;

import jakarta.persistence.LockModeType;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface GroupInvitationRepository extends JpaRepository<GroupInvitation, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select invitation from GroupInvitation invitation where invitation.id = :id")
    Optional<GroupInvitation> findLockedById(@Param("id") UUID id);

    @Query(
            "select invitation from GroupInvitation invitation where invitation.inviteeUserId ="
                    + " :userId or (invitation.inviteeUserId is null and invitation.inviteeEmail ="
                    + " :email)")
    Page<GroupInvitation> inbox(
            @Param("userId") UUID userId, @Param("email") String email, Pageable pageable);

    Page<GroupInvitation> findByGroupId(UUID groupId, Pageable pageable);

    Optional<GroupInvitation> findByGroupIdAndInviteeEmailAndStatus(
            UUID groupId, String inviteeEmail, String status);
}
