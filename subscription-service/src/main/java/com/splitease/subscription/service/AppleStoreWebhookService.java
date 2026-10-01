package com.splitease.subscription.service;

import com.splitease.common.exception.ConflictException;
import com.splitease.common.exception.NotFoundException;
import com.splitease.subscription.domain.Plan;
import com.splitease.subscription.domain.ProcessedStoreNotification;
import com.splitease.subscription.domain.Subscription;
import com.splitease.subscription.dto.SubscriptionDtos;
import com.splitease.subscription.repository.PlanRepository;
import com.splitease.subscription.repository.ProcessedStoreNotificationRepository;
import com.splitease.subscription.repository.SubscriptionRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@ConditionalOnBean(ApplePurchaseVerifier.class)
public class AppleStoreWebhookService {
    private final ApplePurchaseVerifier verifier;
    private final StorePurchaseLock locks;
    private final PlanRepository plans;
    private final SubscriptionRepository subscriptions;
    private final ProcessedStoreNotificationRepository processedNotifications;

    public AppleStoreWebhookService(
            ApplePurchaseVerifier verifier,
            PlanRepository plans,
            SubscriptionRepository subscriptions,
            ProcessedStoreNotificationRepository processedNotifications,
            StorePurchaseLock locks) {
        this.verifier = verifier;
        this.locks = locks;
        this.plans = plans;
        this.subscriptions = subscriptions;
        this.processedNotifications = processedNotifications;
    }

    @Transactional
    public void process(String signedPayload) {
        SubscriptionDtos.StoreNotification notification = verifier.verifyNotification(signedPayload);
        locks.acquire("notification:" + notification.notificationId());
        if (processedNotifications.existsById(notification.notificationId())) {
            return;
        }

        SubscriptionDtos.VerifiedPurchase purchase = notification.purchase();
        locks.acquire(purchase.provider().name() + ":" + purchase.providerReference());
        Plan plan = plans.findByAppleProductIdAndActiveTrue(purchase.productId())
                .orElseThrow(() -> new NotFoundException("Apple product is not mapped to an active plan"));
        subscriptions.findByProviderAndProviderReference(
                        purchase.provider().name(),
                        purchase.providerReference())
                .ifPresentOrElse(
                        subscription -> update(subscription, purchase),
                        () -> createIfActive(plan, purchase));
        processedNotifications.save(new ProcessedStoreNotification(
                notification.notificationId(),
                purchase.provider()));
    }

    private void update(
            Subscription subscription,
            SubscriptionDtos.VerifiedPurchase purchase) {
        if (!subscription.getUserId().equals(purchase.userId())) {
            throw new ConflictException("Apple subscription is assigned to another account");
        }
        subscription.applyVerification(
                purchase.purchasedAt(),
                purchase.expiresAt(),
                purchase.active());
    }

    private void createIfActive(Plan plan, SubscriptionDtos.VerifiedPurchase purchase) {
        if (!purchase.active()) {
            return;
        }
        subscriptions.save(new Subscription(
                purchase.userId(),
                plan,
                purchase.purchasedAt(),
                purchase.expiresAt(),
                purchase.provider(),
                purchase.providerReference()));
    }
}

