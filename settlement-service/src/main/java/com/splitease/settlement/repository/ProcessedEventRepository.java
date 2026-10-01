package com.splitease.settlement.repository;

import java.util.UUID;

import com.splitease.settlement.domain.ProcessedEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProcessedEventRepository extends JpaRepository<ProcessedEvent, UUID> {
}

