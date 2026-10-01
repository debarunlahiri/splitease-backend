package com.splitease.settlement.repository;

import java.util.UUID;

import com.splitease.settlement.domain.ExpenseProjection;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ExpenseProjectionRepository extends JpaRepository<ExpenseProjection, UUID> {
}
