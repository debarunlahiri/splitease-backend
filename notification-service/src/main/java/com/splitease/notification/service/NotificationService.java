package com.splitease.notification.service;

import java.util.UUID;

import com.splitease.common.exception.NotFoundException;
import com.splitease.common.api.PageLimits;
import com.splitease.common.api.PageResponse;
import com.splitease.notification.domain.Notification;
import com.splitease.notification.domain.NotificationPreference;
import com.splitease.notification.repository.NotificationRepository;
import com.splitease.notification.repository.NotificationPreferenceRepository;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationService {
    private final NotificationRepository notifications;
    private final NotificationPreferenceRepository preferences;

    public NotificationService(
            NotificationRepository notifications,
            NotificationPreferenceRepository preferences) {
        this.notifications = notifications;
        this.preferences = preferences;
    }

    @Transactional(readOnly = true)
    public PageResponse<NotificationView> list(UUID userId, int page, int size) {
        return PageResponse.from(notifications.findByUserIdAndInboxVisibleTrue(userId,
                PageLimits.request(page, size, Sort.by(Sort.Order.desc("createdAt"),
                        Sort.Order.desc("id")))).map(NotificationView::from));
    }

    @Transactional(readOnly = true)
    public long unreadCount(UUID userId) {
        return notifications.countByUserIdAndInboxVisibleTrueAndReadFalse(userId);
    }

    @Transactional(readOnly = true)
    public PreferenceView preferences(UUID userId) {
        return preferences.findById(userId)
                .map(PreferenceView::from)
                .orElse(new PreferenceView(true, false, null));
    }

    @Transactional
    public PreferenceView updatePreferences(UUID userId, UpdatePreferences request) {
        String pushToken = request.pushToken() == null ? null : request.pushToken().trim();
        if (request.pushEnabled() && (pushToken == null || pushToken.isBlank())) {
            throw new IllegalArgumentException("A push token is required when push is enabled");
        }
        NotificationPreference preference = preferences.findById(userId)
                .orElseGet(() -> new NotificationPreference(userId));
        preference.update(request.inboxEnabled(), request.pushEnabled(), pushToken);
        return PreferenceView.from(preferences.save(preference));
    }

    @Transactional
    public NotificationView markRead(UUID userId, UUID notificationId) {
        Notification notification = notifications.findByIdAndUserIdAndInboxVisibleTrue(notificationId, userId)
                .orElseThrow(() -> new NotFoundException("Notification not found"));
        notification.markRead();
        return NotificationView.from(notification);
    }

    public record NotificationView(
            UUID id, String type, String title, String message,
            boolean read, java.time.Instant createdAt) {
        static NotificationView from(Notification value) {
            return new NotificationView(value.getId(), value.getType(), value.getTitle(),
                    value.getMessage(), value.isRead(), value.getCreatedAt());
        }
    }

    public record PreferenceView(boolean inboxEnabled, boolean pushEnabled, String pushToken) {
        static PreferenceView from(NotificationPreference value) {
            return new PreferenceView(value.isInboxEnabled(), value.isPushEnabled(), value.getPushToken());
        }
    }

    public record UpdatePreferences(
            boolean inboxEnabled,
            boolean pushEnabled,
            @jakarta.validation.constraints.Size(max = 500) String pushToken) {
    }
}
