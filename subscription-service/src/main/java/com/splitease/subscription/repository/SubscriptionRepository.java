package com.splitease.subscription.repository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.splitease.subscription.domain.Subscription;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SubscriptionRepository extends JpaRepository<Subscription, UUID> {
    Optional<Subscription> findFirstByUserIdAndStatusAndExpiresAtAfterOrderByExpiresAtDesc(
            UUID userId, String status, Instant now);
    Optional<Subscription> findByProviderAndProviderReference(String provider, String providerReference);
}
