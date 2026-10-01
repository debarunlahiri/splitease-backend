package com.splitease.group.repository;

import java.util.UUID;

import com.splitease.group.domain.ExpenseGroup;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

public interface ExpenseGroupRepository extends JpaRepository<ExpenseGroup, UUID> {
    Page<ExpenseGroup> findDistinctByMembersUserId(UUID userId, Pageable pageable);
}
