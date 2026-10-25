package com.splitease.notification.repository;

import com.splitease.notification.domain.PendingInvitationAlert;

import jakarta.persistence.LockModeType;

import org.springframework.data.jpa.repository.*;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface PendingInvitationAlertRepository
        extends JpaRepository<PendingInvitationAlert, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select alert from PendingInvitationAlert alert where alert.email = :email and"
                + " alert.deliveredTo is null")
    List<PendingInvitationAlert> undelivered(@Param("email") String email);
}
