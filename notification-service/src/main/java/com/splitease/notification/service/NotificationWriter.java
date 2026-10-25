package com.splitease.notification.service;

import com.splitease.notification.domain.*;
import com.splitease.notification.repository.*;

import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
public class NotificationWriter {
    private final NotificationRepository notifications;
    private final NotificationPreferenceRepository preferences;
    private final PushDeliveryRepository pushes;

    public NotificationWriter(
            NotificationRepository notifications,
            NotificationPreferenceRepository preferences,
            PushDeliveryRepository pushes) {
        this.notifications = notifications;
        this.preferences = preferences;
        this.pushes = pushes;
    }

    public void save(
            UUID userId,
            String type,
            String title,
            String message,
            UUID groupId,
            UUID invitationId,
            UUID expenseId) {
        var preference = preferences.findById(userId).orElse(null);
        boolean inbox = preference == null || preference.isInboxEnabled();
        boolean push = preference != null && preference.isPushEnabled();
        if (!inbox && !push) return;
        Notification notification = new Notification(userId, type, title, message, inbox);
        notification.targets(groupId, invitationId, expenseId);
        notification = notifications.save(notification);
        if (push) pushes.save(new PushDelivery(notification.getId(), userId));
    }
}
