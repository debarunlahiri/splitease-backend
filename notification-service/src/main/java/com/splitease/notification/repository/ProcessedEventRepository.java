package com.splitease.notification.repository;

import java.util.UUID;

import com.splitease.notification.domain.ProcessedEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProcessedEventRepository extends JpaRepository<ProcessedEvent, UUID> {
}

