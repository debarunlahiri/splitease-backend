package com.splitease.group.repository;

import com.splitease.group.domain.ExpenseGroup;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface ExpenseGroupRepository extends JpaRepository<ExpenseGroup, UUID> {
    Page<ExpenseGroup> findDistinctByMembersUserId(UUID userId, Pageable pageable);
}
