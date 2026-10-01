package com.splitease.notification.repository;

import java.util.UUID;

import com.splitease.notification.domain.NotificationPreference;
import org.springframework.data.jpa.repository.JpaRepository;

public interface NotificationPreferenceRepository extends JpaRepository<NotificationPreference, UUID> {
}
