package com.splitease.notification.repository;

import java.util.Optional;
import java.util.UUID;

import com.splitease.notification.domain.Notification;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {
    Page<Notification> findByUserIdAndInboxVisibleTrue(UUID userId, Pageable pageable);
    Optional<Notification> findByIdAndUserIdAndInboxVisibleTrue(UUID id, UUID userId);
    long countByUserIdAndInboxVisibleTrueAndReadFalse(UUID userId);
}
