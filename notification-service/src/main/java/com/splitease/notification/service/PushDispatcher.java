package com.splitease.notification.service;

import java.time.Instant;

import com.splitease.notification.domain.Notification;
import com.splitease.notification.domain.NotificationPreference;
import com.splitease.notification.repository.NotificationPreferenceRepository;
import com.splitease.notification.repository.NotificationRepository;
import com.splitease.notification.repository.PushDeliveryRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@ConditionalOnProperty(prefix = "notifications.push", name = "enabled", havingValue = "true")
public class PushDispatcher {
    private final PushDeliveryRepository deliveries;
    private final NotificationRepository notifications;
    private final NotificationPreferenceRepository preferences;
    private final PushProvider provider;

    public PushDispatcher(
            PushDeliveryRepository deliveries,
            NotificationRepository notifications,
            NotificationPreferenceRepository preferences,
            PushProvider provider) {
        this.deliveries = deliveries;
        this.notifications = notifications;
        this.preferences = preferences;
        this.provider = provider;
    }

    @Scheduled(fixedDelayString = "${notifications.push.dispatch-delay:PT5S}")
    @Transactional
    public void dispatchPending() {
        deliveries.claimPending(Instant.now(), 50).forEach(delivery -> {
            NotificationPreference preference = preferences.findById(delivery.getUserId()).orElse(null);
            if (preference == null || !preference.isPushEnabled()
                    || preference.getPushToken() == null || preference.getPushToken().isBlank()) {
                delivery.delivered();
                return;
            }
            Notification notification = notifications.findById(delivery.getNotificationId()).orElse(null);
            if (notification == null) {
                delivery.delivered();
                return;
            }
            try {
                provider.deliver(preference.getPushToken(), notification);
                delivery.delivered();
            } catch (Exception exception) {
                delivery.retry(exception.getMessage());
            }
        });
    }
}
