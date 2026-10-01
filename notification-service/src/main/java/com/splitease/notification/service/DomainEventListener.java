package com.splitease.notification.service;

import java.util.UUID;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.splitease.common.event.ExpenseCreatedEvent;
import com.splitease.common.event.SettlementRecordedEvent;
import com.splitease.notification.domain.Notification;
import com.splitease.notification.domain.NotificationPreference;
import com.splitease.notification.domain.ProcessedEvent;
import com.splitease.notification.domain.PushDelivery;
import com.splitease.notification.repository.NotificationPreferenceRepository;
import com.splitease.notification.repository.NotificationRepository;
import com.splitease.notification.repository.ProcessedEventRepository;
import com.splitease.notification.repository.PushDeliveryRepository;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class DomainEventListener {
    private final NotificationRepository notifications;
    private final ProcessedEventRepository processedEvents;
    private final ObjectMapper objectMapper;
    private final NotificationPreferenceRepository preferences;
    private final PushDeliveryRepository pushDeliveries;

    public DomainEventListener(
            NotificationRepository notifications,
            ProcessedEventRepository processedEvents,
            ObjectMapper objectMapper,
            NotificationPreferenceRepository preferences,
            PushDeliveryRepository pushDeliveries) {
        this.notifications = notifications;
        this.processedEvents = processedEvents;
        this.objectMapper = objectMapper;
        this.preferences = preferences;
        this.pushDeliveries = pushDeliveries;
    }

    @KafkaListener(topics = "expense.created", groupId = "notification-service")
    @Transactional
    public void expenseCreated(String payload) {
        ExpenseCreatedEvent event = read(payload, ExpenseCreatedEvent.class);
        if (processedEvents.existsById(event.eventId())) {
            return;
        }
        saveNotification(
                event.paidBy(),
                "EXPENSE_CREATED",
                "Expense added",
                "Your " + event.currency() + " " + event.amount() + " expense was added.");
        processedEvents.save(new ProcessedEvent(event.eventId(), ExpenseCreatedEvent.class.getSimpleName()));
    }

    @KafkaListener(topics = "settlement.recorded", groupId = "notification-service")
    @Transactional
    public void settlementRecorded(String payload) {
        SettlementRecordedEvent event = read(payload, SettlementRecordedEvent.class);
        if (processedEvents.existsById(event.eventId())) {
            return;
        }
        saveNotification(
                event.payeeId(),
                "SETTLEMENT_RECORDED",
                "Payment recorded",
                "A " + event.currency() + " " + event.amount() + " payment was recorded for you.");
        processedEvents.save(new ProcessedEvent(event.eventId(), SettlementRecordedEvent.class.getSimpleName()));
    }

    private void saveNotification(UUID userId, String type, String title, String message) {
        NotificationPreference preference = preferences.findById(userId).orElse(null);
        boolean inboxEnabled = preference == null || preference.isInboxEnabled();
        boolean pushEnabled = preference != null && preference.isPushEnabled();
        if (!inboxEnabled && !pushEnabled) {
            return;
        }
        Notification notification = notifications.save(new Notification(
                userId, type, title, message, inboxEnabled));
        if (pushEnabled) {
            pushDeliveries.save(new PushDelivery(notification.getId(), notification.getUserId()));
        }
    }

    private <T> T read(String payload, Class<T> eventType) {
        try {
            return objectMapper.readValue(payload, eventType);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Invalid " + eventType.getSimpleName() + " payload", exception);
        }
    }
}
