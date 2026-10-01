package com.splitease.subscription.service;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.splitease.common.exception.ConflictException;
import com.splitease.common.exception.NotFoundException;
import com.splitease.subscription.domain.Plan;
import com.splitease.subscription.domain.Subscription;
import com.splitease.subscription.dto.SubscriptionDtos;
import com.splitease.subscription.repository.PlanRepository;
import com.splitease.subscription.repository.SubscriptionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SubscriptionService {
    private final PlanRepository plans;
    private final SubscriptionRepository subscriptions;
    private final PurchaseVerifierRegistry purchaseVerifiers;
    private final StorePurchaseLock locks;

    public SubscriptionService(
            PlanRepository plans,
            SubscriptionRepository subscriptions,
            PurchaseVerifierRegistry purchaseVerifiers,
            StorePurchaseLock locks) {
        this.plans = plans;
        this.subscriptions = subscriptions;
        this.purchaseVerifiers = purchaseVerifiers;
        this.locks = locks;
    }

    @Transactional(readOnly = true)
    public List<SubscriptionDtos.PlanView> plans() {
        return plans.findByActiveTrueOrderByPriceAsc().stream()
                .map(plan -> new SubscriptionDtos.PlanView(plan.getCode(), plan.getName(), plan.getPrice(),
                        plan.getCurrency(), plan.getDurationDays(), plan.isRemovesAds()))
                .toList();
    }

    @Transactional(readOnly = true)
    public SubscriptionDtos.Entitlement entitlement(UUID userId) {
        return subscriptions.findFirstByUserIdAndStatusAndExpiresAtAfterOrderByExpiresAtDesc(
                        userId, "ACTIVE", Instant.now())
                .map(subscription -> new SubscriptionDtos.Entitlement(
                        !subscription.getPlan().isRemovesAds(),
                        subscription.getPlan().getCode(),
                        subscription.getExpiresAt()))
                .orElseGet(SubscriptionDtos.Entitlement::free);
    }

    @Transactional
    public SubscriptionDtos.Entitlement verifyPurchase(
            UUID userId,
            SubscriptionDtos.VerifyPurchase request) {
        Plan plan = plans.findByCodeAndActiveTrue(request.planCode())
                .orElseThrow(() -> new NotFoundException("Subscription plan not found"));
        PurchaseVerifier verifier = purchaseVerifiers.required(request.provider());
        if (verifier instanceof GooglePlayPurchaseVerifier googleVerifier) {
            locks.acquire(verifier.provider().name() + ":" + googleVerifier.tokenReference(request.purchaseToken()));
        }
        SubscriptionDtos.VerifiedPurchase verified = verifier.verify(userId, plan, request.purchaseToken());
        if (!verified.active() || !verified.expiresAt().isAfter(Instant.now())) {
            throw new IllegalArgumentException("The store purchase is not active");
        }

        locks.acquire(verified.provider().name() + ":" + verified.providerReference());
        Subscription subscription = subscriptions
                .findByProviderAndProviderReference(
                        verified.provider().name(),
                        verified.providerReference())
                .map(existing -> applyVerification(existing, userId, verified))
                .orElseGet(() -> subscriptions.save(new Subscription(
                        userId,
                        plan,
                        verified.purchasedAt(),
                        verified.expiresAt(),
                        verified.provider(),
                        verified.providerReference())));
        return entitlement(subscription);
    }

    private Subscription requireOwner(Subscription subscription, UUID userId) {
        if (!subscription.getUserId().equals(userId)) {
            throw new ConflictException("This store transaction is already assigned to another account");
        }
        return subscription;
    }

    private Subscription applyVerification(
            Subscription subscription,
            UUID userId,
            SubscriptionDtos.VerifiedPurchase verified) {
        requireOwner(subscription, userId);
        subscription.applyVerification(
                verified.purchasedAt(),
                verified.expiresAt(),
                verified.active());
        return subscription;
    }

    private SubscriptionDtos.Entitlement entitlement(Subscription subscription) {
        return new SubscriptionDtos.Entitlement(
                !subscription.getPlan().isRemovesAds(),
                subscription.getPlan().getCode(),
                subscription.getExpiresAt());
    }
}
