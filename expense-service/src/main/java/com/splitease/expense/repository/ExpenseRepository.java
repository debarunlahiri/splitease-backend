package com.splitease.expense.repository;

import java.util.Optional;
import java.util.UUID;

import com.splitease.expense.domain.Expense;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

public interface ExpenseRepository extends JpaRepository<Expense, UUID> {
    Page<Expense> findByGroupIdAndDeletedAtIsNull(UUID groupId, Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select expense from Expense expense where expense.id = :id")
    Optional<Expense> findLockedById(@Param("id") UUID id);
}
