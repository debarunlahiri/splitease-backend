package com.splitease.group.repository;

import java.util.List;
import java.util.UUID;

import com.splitease.group.domain.ExpenseGroup;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ExpenseGroupRepository extends JpaRepository<ExpenseGroup, UUID> {
    @EntityGraph(attributePaths = "members")
    List<ExpenseGroup> findDistinctByMembersUserIdOrderByCreatedAtDesc(UUID userId);
}
