package com.splitease.settlement.repository;

import java.util.List;
import java.util.UUID;

import com.splitease.settlement.domain.Settlement;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SettlementRepository extends JpaRepository<Settlement, UUID> {
    List<Settlement> findByGroupIdOrderByCreatedAtDesc(UUID groupId);
}

