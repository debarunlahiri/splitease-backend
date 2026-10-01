package com.splitease.subscription.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.splitease.common.exception.ConflictException;
import com.splitease.common.exception.NotFoundException;
import com.splitease.subscription.domain.Plan;
import com.splitease.subscription.domain.ProcessedStoreNotification;
import com.splitease.subscription.domain.StoreProvider;
import com.splitease.subscription.domain.Subscription;
import com.splitease.subscription.dto.SubscriptionDtos;
import com.splitease.subscription.repository.PlanRepository;
import com.splitease.subscription.repository.ProcessedStoreNotificationRepository;
import com.splitease.subscription.repository.SubscriptionRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@ConditionalOnProperty(prefix = "stores.google", name = "enabled", havingValue = "true")
public class GoogleStoreWebhookService {
    private final GooglePlayPurchaseVerifier verifier;
    private final ObjectMapper objectMapper;
    private final PlanRepository plans;
    private final SubscriptionRepository subscriptions;
    private final ProcessedStoreNotificationRepository notifications;
    private final StorePurchaseLock locks;
    private final String packageName;
    private final String pushSubscription;

    public GoogleStoreWebhookService(
            GooglePlayPurchaseVerifier verifier,
            ObjectMapper objectMapper,
            PlanRepository plans,
            SubscriptionRepository subscriptions,
            ProcessedStoreNotificationRepository notifications,
            StorePurchaseLock locks,
            @Value("${stores.google.package-name}") String packageName,
            @Value("${stores.google.push-subscription}") String pushSubscription) {
        if (pushSubscription.isBlank()) {
            throw new IllegalStateException("Google push subscription is required");
        }
        this.verifier = verifier;
        this.objectMapper = objectMapper;
        this.plans = plans;
        this.subscriptions = subscriptions;
        this.notifications = notifications;
        this.locks = locks;
        this.packageName = packageName;
        this.pushSubscription = pushSubscription;
    }

    @Transactional
    public void process(String subscriptionName, String messageId, String data) {
        if (!pushSubscription.equals(subscriptionName)) {
            throw new IllegalArgumentException("Unexpected Google push subscription");
        }
        UUID notificationId = UUID.nameUUIDFromBytes(
                ("GOOGLE_PLAY:" + subscriptionName + ":" + messageId).getBytes(StandardCharsets.UTF_8));
        locks.acquire("notification:" + notificationId);
        if (notifications.existsById(notificationId)) {
            return;
        }
        JsonNode payload = decode(data);
        if (!packageName.equals(payload.path("packageName").asText())) {
            throw new IllegalArgumentException("Unexpected Google Play package");
        }
        if (payload.has("testNotification")) {
            markProcessed(notificationId);
            return;
        }
        String token = payload.path("subscriptionNotification").path("purchaseToken").asText();
        if (token.isBlank()) {
            token = payload.path("voidedPurchaseNotification").path("purchaseToken").asText();
        }
        if (token.isBlank()) {
            throw new IllegalArgumentException("Google notification has no subscription purchase token");
        }
        locks.acquire(StoreProvider.GOOGLE_PLAY.name() + ":" + verifier.tokenReference(token));
        SubscriptionDtos.VerifiedPurchase purchase = verifier.verifyNotification(token);
        Plan plan = plans.findByGoogleProductIdAndActiveTrue(purchase.productId())
                .orElseThrow(() -> new NotFoundException("Google product is not mapped to an active plan"));
        boolean active = purchase.active() && purchase.expiresAt().isAfter(Instant.now());
        subscriptions.findByProviderAndProviderReference(
                        purchase.provider().name(), purchase.providerReference())
                .ifPresentOrElse(existing -> {
                    if (!existing.getUserId().equals(purchase.userId())) {
                        throw new ConflictException("Google subscription is assigned to another account");
                    }
                    existing.applyVerification(purchase.purchasedAt(), purchase.expiresAt(), active);
                }, () -> {
                    if (active) {
                        subscriptions.save(new Subscription(purchase.userId(), plan, purchase.purchasedAt(),
                                purchase.expiresAt(), purchase.provider(), purchase.providerReference()));
                    }
                });
        markProcessed(notificationId);
    }

    private JsonNode decode(String data) {
        try {
            JsonNode payload = objectMapper.readTree(Base64.getDecoder().decode(data));
            if (payload == null || !payload.isObject()) {
                throw new IllegalArgumentException("Google notification must be an object");
            }
            return payload;
        } catch (IOException | IllegalArgumentException exception) {
            throw new IllegalArgumentException("Invalid Google notification data", exception);
        }
    }

    private void markProcessed(UUID notificationId) {
        notifications.save(new ProcessedStoreNotification(notificationId, StoreProvider.GOOGLE_PLAY));
    }
}
