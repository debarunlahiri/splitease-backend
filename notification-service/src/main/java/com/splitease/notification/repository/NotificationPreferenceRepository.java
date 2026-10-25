package com.splitease.notification.repository;

import com.splitease.notification.domain.NotificationPreference;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface NotificationPreferenceRepository
        extends JpaRepository<NotificationPreference, UUID> {}
