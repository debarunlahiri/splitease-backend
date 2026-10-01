package com.splitease.subscription.service;

import java.util.UUID;

import com.splitease.subscription.domain.Plan;
import com.splitease.subscription.domain.StoreProvider;
import com.splitease.subscription.dto.SubscriptionDtos;

public interface PurchaseVerifier {
    StoreProvider provider();

    SubscriptionDtos.VerifiedPurchase verify(UUID userId, Plan plan, String purchaseToken);
}
