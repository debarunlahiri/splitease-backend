package com.splitease.expense.repository;

import java.util.List;
import java.util.UUID;

import com.splitease.expense.domain.Expense;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ExpenseRepository extends JpaRepository<Expense, UUID> {
    @EntityGraph(attributePaths = "shares")
    List<Expense> findByGroupIdOrderByExpenseDateDescCreatedAtDesc(UUID groupId);
}

