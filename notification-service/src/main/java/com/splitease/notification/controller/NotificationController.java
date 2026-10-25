package com.splitease.notification.controller;

import com.splitease.common.api.PageResponse;
import com.splitease.common.idempotency.IdempotentRequest;
import com.splitease.notification.service.NotificationService;
import com.splitease.notification.service.NotificationService.NotificationView;
import com.splitease.notification.service.NotificationService.PreferenceView;
import com.splitease.notification.service.NotificationService.UpdatePreferences;

import jakarta.validation.Valid;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/notifications")
public class NotificationController {
    private final NotificationService notificationService;
    private final com.splitease.notification.service.InvitationAlertService invitationAlerts;

    public NotificationController(
            NotificationService notificationService,
            com.splitease.notification.service.InvitationAlertService invitationAlerts) {
        this.invitationAlerts = invitationAlerts;
        this.notificationService = notificationService;
    }

    @GetMapping
    public PageResponse<NotificationView> list(
            @RequestHeader("X-User-Id") UUID userId,
            @RequestHeader("X-User-Email") String email,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        invitationAlerts.deliverPending(userId, email);
        return notificationService.list(userId, page, size);
    }

    @GetMapping("/unread-count")
    public UnreadCount unreadCount(
            @RequestHeader("X-User-Id") UUID userId, @RequestHeader("X-User-Email") String email) {
        invitationAlerts.deliverPending(userId, email);
        return new UnreadCount(notificationService.unreadCount(userId));
    }

    @GetMapping("/preferences")
    public PreferenceView preferences(@RequestHeader("X-User-Id") UUID userId) {
        return notificationService.preferences(userId);
    }

    @IdempotentRequest
    @PutMapping("/preferences")
    public PreferenceView updatePreferences(
            @RequestHeader("X-User-Id") UUID userId,
            @Valid @RequestBody UpdatePreferences request) {
        return notificationService.updatePreferences(userId, request);
    }

    @IdempotentRequest
    @PatchMapping("/{notificationId}/read")
    public NotificationView markRead(
            @RequestHeader("X-User-Id") UUID userId, @PathVariable UUID notificationId) {
        return notificationService.markRead(userId, notificationId);
    }

    public record UnreadCount(long count) {}
}
