package com.splitease.subscription.service;

import java.time.Instant;
import java.util.UUID;

import com.apple.itunes.storekit.model.JWSTransactionDecodedPayload;
import com.apple.itunes.storekit.model.ResponseBodyV2DecodedPayload;
import com.apple.itunes.storekit.verification.SignedDataVerifier;
import com.apple.itunes.storekit.verification.VerificationException;
import com.splitease.subscription.domain.Plan;
import com.splitease.subscription.domain.StoreProvider;
import com.splitease.subscription.dto.SubscriptionDtos;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnBean(SignedDataVerifier.class)
public class ApplePurchaseVerifier implements PurchaseVerifier {
    private final SignedDataVerifier verifier;

    public ApplePurchaseVerifier(SignedDataVerifier verifier) {
        this.verifier = verifier;
    }

    @Override
    public StoreProvider provider() {
        return StoreProvider.APPLE_APP_STORE;
    }

    @Override
    public SubscriptionDtos.VerifiedPurchase verify(UUID userId, Plan plan, String signedTransaction) {
        String expectedProductId = requiredProductId(plan.getAppleProductId());
        try {
            JWSTransactionDecodedPayload transaction = verifier.verifyAndDecodeTransaction(signedTransaction);
            return verifiedPurchase(userId, expectedProductId, transaction);
        } catch (VerificationException exception) {
            throw new IllegalArgumentException("Apple transaction signature verification failed", exception);
        }
    }

    public SubscriptionDtos.StoreNotification verifyNotification(String signedPayload) {
        try {
            ResponseBodyV2DecodedPayload notification = verifier.verifyAndDecodeNotification(signedPayload);
            if (notification.getData() == null || notification.getData().getSignedTransactionInfo() == null) {
                throw new IllegalArgumentException("Apple notification has no transaction information");
            }
            JWSTransactionDecodedPayload transaction = verifier.verifyAndDecodeTransaction(
                    notification.getData().getSignedTransactionInfo());
            UUID userId = transaction.getAppAccountToken();
            if (userId == null) {
                throw new IllegalArgumentException("Apple transaction has no app account token");
            }
            return new SubscriptionDtos.StoreNotification(
                    UUID.fromString(notification.getNotificationUUID()),
                    verifiedPurchase(userId, transaction.getProductId(), transaction));
        } catch (VerificationException exception) {
            throw new IllegalArgumentException("Apple notification signature verification failed", exception);
        }
    }

    private SubscriptionDtos.VerifiedPurchase verifiedPurchase(
            UUID expectedUserId,
            String expectedProductId,
            JWSTransactionDecodedPayload transaction) {
        if (!expectedProductId.equals(transaction.getProductId())) {
            throw new IllegalArgumentException("Apple transaction does not match the requested plan");
        }
        if (!expectedUserId.equals(transaction.getAppAccountToken())) {
            throw new IllegalArgumentException("Apple transaction belongs to another user");
        }
        Instant purchasedAt = Instant.ofEpochMilli(transaction.getPurchaseDate());
        Instant expiresAt = Instant.ofEpochMilli(transaction.getExpiresDate());
        boolean active = transaction.getRevocationDate() == null && expiresAt.isAfter(Instant.now());
        return new SubscriptionDtos.VerifiedPurchase(
                provider(),
                transaction.getOriginalTransactionId(),
                transaction.getProductId(),
                expectedUserId,
                purchasedAt,
                expiresAt,
                active);
    }

    private String requiredProductId(String productId) {
        if (productId == null || productId.isBlank()) {
            throw new IllegalStateException("The selected plan has no Apple product id");
        }
        return productId;
    }
}
