package com.splitease.settlement.repository;

import java.util.List;
import java.util.UUID;

import com.splitease.settlement.domain.OutboxEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OutboxEventRepository extends JpaRepository<OutboxEvent, UUID> {
    List<OutboxEvent> findTop100ByPublishedAtIsNullOrderByCreatedAtAsc();
}

