package com.splitease.subscription.service;

import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Component;

@Component
public class StorePurchaseLock {
    private final EntityManager entityManager;

    public StorePurchaseLock(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    // Transaction-scoped database locks also serialize requests across service instances.
    public void acquire(String key) {
        entityManager.createNativeQuery("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))")
                .setParameter("key", key)
                .getSingleResult();
    }
}
