package com.splitease.subscription.controller;

import java.util.List;
import java.util.UUID;

import com.splitease.subscription.dto.SubscriptionDtos;
import com.splitease.subscription.service.SubscriptionService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/subscriptions")
public class SubscriptionController {
    private final SubscriptionService subscriptionService;

    public SubscriptionController(SubscriptionService subscriptionService) {
        this.subscriptionService = subscriptionService;
    }

    @GetMapping("/plans")
    public List<SubscriptionDtos.PlanView> plans() { return subscriptionService.plans(); }

    @GetMapping("/me/entitlement")
    public SubscriptionDtos.Entitlement entitlement(@RequestHeader("X-User-Id") UUID userId) {
        return subscriptionService.entitlement(userId);
    }

    @PostMapping("/me/purchases/verify")
    public SubscriptionDtos.Entitlement verifyPurchase(
            @RequestHeader("X-User-Id") UUID userId,
            @Valid @RequestBody SubscriptionDtos.VerifyPurchase request) {
        return subscriptionService.verifyPurchase(userId, request);
    }
}
