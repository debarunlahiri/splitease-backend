package com.splitease.group.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Component;

@Component
public class InternalServiceAuthorizer {
    private final byte[] expectedServiceKey;

    public InternalServiceAuthorizer(@Value("${security.internal.service-key}") String serviceKey) {
        this.expectedServiceKey = serviceKey.getBytes(StandardCharsets.UTF_8);
    }

    public void requireValid(String suppliedServiceKey) {
        byte[] supplied = suppliedServiceKey == null
                ? new byte[0]
                : suppliedServiceKey.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(expectedServiceKey, supplied)) {
            throw new AccessDeniedException("Invalid internal service credentials");
        }
    }
}

