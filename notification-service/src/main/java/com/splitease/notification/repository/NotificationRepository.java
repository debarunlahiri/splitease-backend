package com.splitease.notification.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.splitease.notification.domain.Notification;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NotificationRepository extends JpaRepository<Notification, UUID> {
    List<Notification> findByUserIdOrderByCreatedAtDesc(UUID userId);
    Optional<Notification> findByIdAndUserId(UUID id, UUID userId);
}
