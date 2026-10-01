package com.splitease.subscription.service;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.util.List;

import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.gson.GsonFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "stores.google", name = "enabled", havingValue = "true")
public class GooglePushAuthenticator {
    private final GoogleIdTokenVerifier verifier;
    private final String serviceAccountEmail;

    public GooglePushAuthenticator(
            @Value("${stores.google.push-audience}") String audience,
            @Value("${stores.google.push-service-account-email}") String serviceAccountEmail) {
        if (audience.isBlank() || serviceAccountEmail.isBlank()) {
            throw new IllegalStateException("Google push audience and service account email are required");
        }
        this.verifier = new GoogleIdTokenVerifier.Builder(
                new NetHttpTransport(), GsonFactory.getDefaultInstance())
                .setAudience(List.of(audience))
                .build();
        this.serviceAccountEmail = serviceAccountEmail;
    }

    public void authenticate(String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            throw new BadCredentialsException("Google push authentication is required");
        }
        try {
            GoogleIdToken token = verifier.verify(authorization.substring(7));
            if (token == null || !Boolean.TRUE.equals(token.getPayload().getEmailVerified())
                    || !serviceAccountEmail.equals(token.getPayload().getEmail())) {
                throw new BadCredentialsException("Invalid Google push identity");
            }
        } catch (GeneralSecurityException | IllegalArgumentException exception) {
            throw new BadCredentialsException("Invalid Google push token", exception);
        } catch (IOException exception) {
            throw new IllegalStateException("Google push signing keys could not be loaded", exception);
        }
    }
}
