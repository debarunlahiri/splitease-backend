package com.splitease.subscription.repository;

import java.util.UUID;

import com.splitease.subscription.domain.ProcessedStoreNotification;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProcessedStoreNotificationRepository
        extends JpaRepository<ProcessedStoreNotification, UUID> {
}

