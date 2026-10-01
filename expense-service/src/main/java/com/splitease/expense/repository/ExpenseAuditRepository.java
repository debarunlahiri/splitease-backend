package com.splitease.expense.repository;

import java.util.UUID;

import com.splitease.expense.domain.ExpenseAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

public interface ExpenseAuditRepository extends JpaRepository<ExpenseAudit, UUID> {
    Page<ExpenseAudit> findByExpenseId(UUID expenseId, Pageable pageable);
}
