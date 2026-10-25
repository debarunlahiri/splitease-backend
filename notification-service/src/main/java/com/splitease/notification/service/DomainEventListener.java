package com.splitease.notification.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.splitease.common.event.*;
import com.splitease.notification.domain.ProcessedEvent;
import com.splitease.notification.repository.ProcessedEventRepository;

import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

@Component
public class DomainEventListener {
    private final ProcessedEventRepository processed;
    private final ObjectMapper mapper;
    private final NotificationWriter writer;
    private final InvitationAlertService invitations;
    private final GroupNameClient groups;

    public DomainEventListener(
            ProcessedEventRepository processed,
            ObjectMapper mapper,
            NotificationWriter writer,
            InvitationAlertService invitations,
            GroupNameClient groups) {
        this.processed = processed;
        this.mapper = mapper;
        this.writer = writer;
        this.invitations = invitations;
        this.groups = groups;
    }

    @KafkaListener(topics = "invitation.created", groupId = "notification-service")
    @Transactional
    public void invitationCreated(String payload) {
        InvitationCreatedEvent event = read(payload, InvitationCreatedEvent.class);
        if (processed.existsById(event.eventId())) return;
        invitations.received(event);
        processed.save(new ProcessedEvent(event.eventId(), "InvitationCreatedEvent"));
    }

    @KafkaListener(topics = "expense.created", groupId = "notification-service")
    @Transactional
    public void expenseCreated(String payload) {
        ExpenseCreatedEvent event = read(payload, ExpenseCreatedEvent.class);
        if (processed.existsById(event.eventId())) return;
        Set<UUID> recipients = new LinkedHashSet<>();
        recipients.add(event.paidBy());
        event.shares().forEach(share -> recipients.add(share.userId()));
        String title = groups.title(event.groupId(), "Expense added");
        recipients.forEach(
                user ->
                        writer.save(
                                user,
                                "EXPENSE_CREATED",
                                title,
                                event.currency()
                                        + " "
                                        + event.amount()
                                        + " was added to your group expenses.",
                                event.groupId(),
                                null,
                                event.expenseId()));
        processed.save(new ProcessedEvent(event.eventId(), "ExpenseCreatedEvent"));
    }

    @KafkaListener(topics = "expense.changed", groupId = "notification-service")
    @Transactional
    public void expenseChanged(String payload) {
        ExpenseChangedEvent event = read(payload, ExpenseChangedEvent.class);
        if (processed.existsById(event.eventId())) return;
        Set<UUID> recipients = new LinkedHashSet<>();
        addParticipants(recipients, event.previous());
        addParticipants(recipients, event.current());
        boolean removed = event.current() == null;
        String title =
                groups.title(event.groupId(), removed ? "Expense removed" : "Expense updated");
        recipients.forEach(
                user ->
                        writer.save(
                                user,
                                removed ? "EXPENSE_DELETED" : "EXPENSE_UPDATED",
                                title,
                                removed
                                        ? "A shared expense was removed. Your balance will update"
                                                + " shortly."
                                        : "A shared expense changed. Check your group's latest"
                                                + " split.",
                                event.groupId(),
                                null,
                                event.expenseId()));
        processed.save(new ProcessedEvent(event.eventId(), "ExpenseChangedEvent"));
    }

    @KafkaListener(topics = "settlement.recorded", groupId = "notification-service")
    @Transactional
    public void settlementRecorded(String payload) {
        SettlementRecordedEvent event = read(payload, SettlementRecordedEvent.class);
        if (processed.existsById(event.eventId())) return;
        writer.save(
                event.payeeId(),
                "SETTLEMENT_RECORDED",
                groups.title(event.groupId(), "Payment recorded"),
                "A " + event.currency() + " " + event.amount() + " payment was recorded for you.",
                event.groupId(),
                null,
                null);
        processed.save(new ProcessedEvent(event.eventId(), "SettlementRecordedEvent"));
    }

    private void addParticipants(Set<UUID> users, ExpenseChangedEvent.Snapshot snapshot) {
        if (snapshot == null) return;
        users.add(snapshot.paidBy());
        snapshot.shares().forEach(share -> users.add(share.userId()));
    }

    private <T> T read(String payload, Class<T> type) {
        try {
            return mapper.readValue(payload, type);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Invalid event payload", exception);
        }
    }
}
