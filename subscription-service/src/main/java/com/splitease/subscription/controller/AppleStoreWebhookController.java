package com.splitease.subscription.controller;

import com.splitease.subscription.service.AppleStoreWebhookService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/subscriptions/webhooks/apple")
@ConditionalOnBean(AppleStoreWebhookService.class)
public class AppleStoreWebhookController {
    private final AppleStoreWebhookService webhookService;

    public AppleStoreWebhookController(AppleStoreWebhookService webhookService) {
        this.webhookService = webhookService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void receive(@Valid @RequestBody AppleNotificationBody body) {
        webhookService.process(body.signedPayload());
    }

    public record AppleNotificationBody(@NotBlank String signedPayload) {
    }
}

