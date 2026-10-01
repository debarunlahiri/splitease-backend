package com.splitease.settlement.repository;

import java.util.UUID;

import com.splitease.settlement.domain.Settlement;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

public interface SettlementRepository extends JpaRepository<Settlement, UUID> {
    Page<Settlement> findByGroupId(UUID groupId, Pageable pageable);
}
