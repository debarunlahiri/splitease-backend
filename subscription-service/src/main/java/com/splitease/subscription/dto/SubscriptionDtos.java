package com.splitease.subscription.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import com.splitease.subscription.domain.StoreProvider;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
public final class SubscriptionDtos {
    private SubscriptionDtos() {
    }

    public record PlanView(String code, String name, BigDecimal price, String currency,
                           int durationDays, boolean removesAds) {
    }

    public record Entitlement(boolean adsEnabled, String planCode, Instant expiresAt) {
        public static Entitlement free() { return new Entitlement(true, "FREE", null); }
    }

    public record VerifyPurchase(
            @NotNull StoreProvider provider,
            @NotBlank String planCode,
            @NotBlank String purchaseToken) {
    }

    public record VerifiedPurchase(
            StoreProvider provider,
            String providerReference,
            String productId,
            UUID userId,
            Instant purchasedAt,
            Instant expiresAt,
            boolean active) {
    }

    public record StoreNotification(UUID notificationId, VerifiedPurchase purchase) {
    }
}
