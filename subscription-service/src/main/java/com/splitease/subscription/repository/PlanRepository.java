package com.splitease.subscription.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.splitease.subscription.domain.Plan;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PlanRepository extends JpaRepository<Plan, UUID> {
    List<Plan> findByActiveTrueOrderByPriceAsc();
    Optional<Plan> findByCodeAndActiveTrue(String code);
    Optional<Plan> findByGoogleProductIdAndActiveTrue(String googleProductId);
    Optional<Plan> findByAppleProductIdAndActiveTrue(String appleProductId);
}
