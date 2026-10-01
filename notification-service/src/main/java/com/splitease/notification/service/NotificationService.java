package com.splitease.notification.service;

import java.util.List;
import java.util.UUID;

import com.splitease.common.exception.NotFoundException;
import com.splitease.notification.domain.Notification;
import com.splitease.notification.repository.NotificationRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationService {
    private final NotificationRepository notifications;

    public NotificationService(NotificationRepository notifications) { this.notifications = notifications; }

    @Transactional(readOnly = true)
    public List<NotificationView> list(UUID userId) {
        return notifications.findByUserIdOrderByCreatedAtDesc(userId).stream().map(NotificationView::from).toList();
    }

    @Transactional
    public NotificationView markRead(UUID userId, UUID notificationId) {
        Notification notification = notifications.findByIdAndUserId(notificationId, userId)
                .orElseThrow(() -> new NotFoundException("Notification not found"));
        notification.markRead();
        return NotificationView.from(notification);
    }

    public record NotificationView(UUID id, String type, String title, String message,
                                   boolean read, java.time.Instant createdAt) {
        static NotificationView from(Notification value) {
            return new NotificationView(value.getId(), value.getType(), value.getTitle(),
                    value.getMessage(), value.isRead(), value.getCreatedAt());
        }
    }
}
