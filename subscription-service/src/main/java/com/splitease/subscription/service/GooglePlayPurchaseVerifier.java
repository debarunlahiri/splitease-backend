package com.splitease.subscription.service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import com.google.auth.oauth2.GoogleCredentials;
import com.splitease.subscription.domain.Plan;
import com.splitease.subscription.domain.StoreProvider;
import com.splitease.subscription.dto.SubscriptionDtos;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
@ConditionalOnProperty(prefix = "stores.google", name = "enabled", havingValue = "true")
public class GooglePlayPurchaseVerifier implements PurchaseVerifier {
    private static final String ANDROID_PUBLISHER_SCOPE =
            "https://www.googleapis.com/auth/androidpublisher";

    private final RestClient restClient;
    private final String packageName;

    public GooglePlayPurchaseVerifier(
            RestClient.Builder restClientBuilder,
            @Value("${stores.google.package-name}") String packageName) {
        this.restClient = restClientBuilder
                .baseUrl("https://androidpublisher.googleapis.com")
                .build();
        this.packageName = packageName;
    }

    @Override
    public StoreProvider provider() {
        return StoreProvider.GOOGLE_PLAY;
    }

    @Override
    public SubscriptionDtos.VerifiedPurchase verify(UUID userId, Plan plan, String purchaseToken) {
        String expectedProductId = requiredProductId(plan.getGoogleProductId());
        JsonNode response = fetchPurchase(purchaseToken);
        return verifiedPurchase(userId, expectedProductId, purchaseToken, response);
    }

    public SubscriptionDtos.VerifiedPurchase verifyNotification(String purchaseToken) {
        JsonNode response = fetchPurchase(purchaseToken);
        JsonNode lineItems = response.path("lineItems");
        if (!lineItems.isArray() || lineItems.size() != 1) {
            throw new IllegalArgumentException("Google Play notification requires one subscription product");
        }
        return verifiedPurchase(readUserId(response), lineItems.get(0).path("productId").asText(),
                purchaseToken, response);
    }

    private JsonNode fetchPurchase(String purchaseToken) {
        JsonNode response = restClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/androidpublisher/v3/applications/{packageName}")
                        .path("/purchases/subscriptionsv2/tokens/{token}")
                        .build(packageName, purchaseToken))
                .headers(headers -> headers.setBearerAuth(accessToken()))
                .retrieve()
                .body(JsonNode.class);

        if (response == null) {
            throw new IllegalArgumentException("Google Play returned an empty purchase response");
        }
        return response;
    }

    private SubscriptionDtos.VerifiedPurchase verifiedPurchase(
            UUID userId, String expectedProductId, String purchaseToken, JsonNode response) {
        String state = response.path("subscriptionState").asText();
        boolean active = state.equals("SUBSCRIPTION_STATE_ACTIVE")
                || state.equals("SUBSCRIPTION_STATE_IN_GRACE_PERIOD")
                || state.equals("SUBSCRIPTION_STATE_CANCELED");
        JsonNode lineItem = findLineItem(response.path("lineItems"), expectedProductId);
        UUID verifiedUserId = readUserId(response);
        if (!userId.equals(verifiedUserId)) {
            throw new IllegalArgumentException("Google Play purchase belongs to another user");
        }

        return new SubscriptionDtos.VerifiedPurchase(
                provider(),
                tokenReference(purchaseToken),
                expectedProductId,
                verifiedUserId,
                Instant.parse(response.path("startTime").asText()),
                Instant.parse(lineItem.path("expiryTime").asText()),
                active);
    }

    private JsonNode findLineItem(JsonNode lineItems, String expectedProductId) {
        for (JsonNode lineItem : lineItems) {
            if (expectedProductId.equals(lineItem.path("productId").asText())) {
                return lineItem;
            }
        }
        throw new IllegalArgumentException("Google Play purchase does not match the requested plan");
    }

    private UUID readUserId(JsonNode response) {
        String externalAccountId = response.path("externalAccountIdentifiers")
                .path("obfuscatedExternalAccountId")
                .asText();
        try {
            return UUID.fromString(externalAccountId);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("Google Play purchase has no valid user binding", exception);
        }
    }

    private String accessToken() {
        try {
            GoogleCredentials credentials = GoogleCredentials.getApplicationDefault()
                    .createScoped(List.of(ANDROID_PUBLISHER_SCOPE));
            credentials.refreshIfExpired();
            return credentials.getAccessToken().getTokenValue();
        } catch (IOException exception) {
            throw new IllegalStateException("Could not obtain Google Play API credentials", exception);
        }
    }

    private String requiredProductId(String productId) {
        if (productId == null || productId.isBlank()) {
            throw new IllegalStateException("The selected plan has no Google Play product id");
        }
        return productId;
    }

    public String tokenReference(String purchaseToken) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(purchaseToken.getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
