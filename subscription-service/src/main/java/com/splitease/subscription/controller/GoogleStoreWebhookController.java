package com.splitease.subscription.controller;

import com.splitease.subscription.service.GooglePushAuthenticator;
import com.splitease.subscription.service.GoogleStoreWebhookService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/subscriptions/webhooks/google")
@ConditionalOnProperty(prefix = "stores.google", name = "enabled", havingValue = "true")
public class GoogleStoreWebhookController {
    private final GooglePushAuthenticator authenticator;
    private final GoogleStoreWebhookService webhookService;

    public GoogleStoreWebhookController(
            GooglePushAuthenticator authenticator, GoogleStoreWebhookService webhookService) {
        this.authenticator = authenticator;
        this.webhookService = webhookService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void receive(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization,
            @Valid @RequestBody PushEnvelope envelope) {
        authenticator.authenticate(authorization);
        webhookService.process(envelope.subscription(), envelope.message().messageId(), envelope.message().data());
    }

    public record PushEnvelope(@NotBlank String subscription, @NotNull @Valid PushMessage message) {
    }

    public record PushMessage(@NotBlank String messageId, @NotBlank String data) {
    }
}
