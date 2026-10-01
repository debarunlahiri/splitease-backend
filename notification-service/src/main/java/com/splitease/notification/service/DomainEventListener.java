package com.splitease.notification.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.splitease.common.event.ExpenseCreatedEvent;
import com.splitease.common.event.SettlementRecordedEvent;
import com.splitease.notification.domain.Notification;
import com.splitease.notification.domain.ProcessedEvent;
import com.splitease.notification.repository.NotificationRepository;
import com.splitease.notification.repository.ProcessedEventRepository;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class DomainEventListener {
    private final NotificationRepository notifications;
    private final ProcessedEventRepository processedEvents;
    private final ObjectMapper objectMapper;

    public DomainEventListener(
            NotificationRepository notifications,
            ProcessedEventRepository processedEvents,
            ObjectMapper objectMapper) {
        this.notifications = notifications;
        this.processedEvents = processedEvents;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(topics = "expense.created", groupId = "notification-service")
    @Transactional
    public void expenseCreated(String payload) {
        ExpenseCreatedEvent event = read(payload, ExpenseCreatedEvent.class);
        if (processedEvents.existsById(event.eventId())) {
            return;
        }
        notifications.save(new Notification(
                event.paidBy(),
                "EXPENSE_CREATED",
                "Expense added",
                "Your " + event.currency() + " " + event.amount() + " expense was added."));
        processedEvents.save(new ProcessedEvent(event.eventId(), ExpenseCreatedEvent.class.getSimpleName()));
    }

    @KafkaListener(topics = "settlement.recorded", groupId = "notification-service")
    @Transactional
    public void settlementRecorded(String payload) {
        SettlementRecordedEvent event = read(payload, SettlementRecordedEvent.class);
        if (processedEvents.existsById(event.eventId())) {
            return;
        }
        notifications.save(new Notification(
                event.payeeId(),
                "SETTLEMENT_RECORDED",
                "Payment recorded",
                "A " + event.currency() + " " + event.amount() + " payment was recorded for you."));
        processedEvents.save(new ProcessedEvent(event.eventId(), SettlementRecordedEvent.class.getSimpleName()));
    }

    private <T> T read(String payload, Class<T> eventType) {
        try {
            return objectMapper.readValue(payload, eventType);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Invalid " + eventType.getSimpleName() + " payload", exception);
        }
    }
}
