package com.splitease.notification.controller;

import java.util.List;
import java.util.UUID;

import com.splitease.notification.service.NotificationService;
import com.splitease.notification.service.NotificationService.NotificationView;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/notifications")
public class NotificationController {
    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @GetMapping
    public List<NotificationView> list(@RequestHeader("X-User-Id") UUID userId) {
        return notificationService.list(userId);
    }

    @PatchMapping("/{notificationId}/read")
    public NotificationView markRead(@RequestHeader("X-User-Id") UUID userId,
                                     @PathVariable UUID notificationId) {
        return notificationService.markRead(userId, notificationId);
    }
}
