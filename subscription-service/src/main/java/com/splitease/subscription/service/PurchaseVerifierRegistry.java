package com.splitease.subscription.service;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

import com.splitease.subscription.domain.StoreProvider;
import org.springframework.stereotype.Component;

@Component
public class PurchaseVerifierRegistry {
    private final Map<StoreProvider, PurchaseVerifier> verifiers;

    public PurchaseVerifierRegistry(List<PurchaseVerifier> purchaseVerifiers) {
        this.verifiers = new EnumMap<>(StoreProvider.class);
        purchaseVerifiers.forEach(verifier -> verifiers.put(verifier.provider(), verifier));
    }

    public PurchaseVerifier required(StoreProvider provider) {
        PurchaseVerifier verifier = verifiers.get(provider);
        if (verifier == null) {
            throw new IllegalStateException("Purchase verification is not configured for " + provider);
        }
        return verifier;
    }
}
