package com.splitease.notification.service;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.splitease.common.event.*;
import com.splitease.notification.repository.ProcessedEventRepository;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

class DomainEventListenerTest {
    private final ProcessedEventRepository processed = mock(ProcessedEventRepository.class);
    private final NotificationWriter writer = mock(NotificationWriter.class);
    private final InvitationAlertService invitations = mock(InvitationAlertService.class);
    private final GroupNameClient groups = mock(GroupNameClient.class);
    private final ObjectMapper mapper = new ObjectMapper().findAndRegisterModules();
    private final DomainEventListener listener =
            new DomainEventListener(processed, mapper, writer, invitations, groups);

    @Test
    void createdExpenseNotifiesPayerAndEveryParticipantOnce() throws Exception {
        UUID payer = UUID.randomUUID(),
                other = UUID.randomUUID(),
                group = UUID.randomUUID(),
                expense = UUID.randomUUID();
        when(groups.title(group, "Expense added")).thenReturn("Weekend trip · Expense added");
        var event =
                new ExpenseCreatedEvent(
                        UUID.randomUUID(),
                        expense,
                        group,
                        payer,
                        BigDecimal.TEN,
                        "INR",
                        List.of(
                                new ExpenseCreatedEvent.Share(payer, BigDecimal.ONE),
                                new ExpenseCreatedEvent.Share(other, BigDecimal.ONE)),
                        Instant.now());
        listener.expenseCreated(mapper.writeValueAsString(event));
        verify(writer)
                .save(
                        eq(payer),
                        eq("EXPENSE_CREATED"),
                        eq("Weekend trip · Expense added"),
                        anyString(),
                        eq(group),
                        isNull(),
                        eq(expense));
        verify(writer)
                .save(
                        eq(other),
                        eq("EXPENSE_CREATED"),
                        eq("Weekend trip · Expense added"),
                        anyString(),
                        eq(group),
                        isNull(),
                        eq(expense));
        verifyNoMoreInteractions(writer);
    }

    @Test
    void alreadyProcessedExpenseIsNotDeliveredAgain() throws Exception {
        UUID id = UUID.randomUUID();
        var event =
                new ExpenseCreatedEvent(
                        id,
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        BigDecimal.ONE,
                        "INR",
                        List.of(),
                        Instant.now());
        when(processed.existsById(id)).thenReturn(true);
        listener.expenseCreated(mapper.writeValueAsString(event));
        verifyNoInteractions(writer);
    }

    @Test
    void invitationEventIsStoredThroughRecipientDeliveryService() throws Exception {
        var event =
                new InvitationCreatedEvent(
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        "Trip",
                        "friend@example.com",
                        UUID.randomUUID(),
                        Instant.now().plusSeconds(600),
                        Instant.now());
        listener.invitationCreated(mapper.writeValueAsString(event));
        verify(invitations).received(event);
        verify(processed).save(any());
    }

    @Test
    void deletedExpenseNotifiesPreviousParticipants() throws Exception {
        UUID payer = UUID.randomUUID();
        var event =
                new ExpenseChangedEvent(
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        2,
                        new ExpenseChangedEvent.Snapshot(payer, BigDecimal.TEN, "INR", List.of()),
                        null,
                        Instant.now());
        when(groups.title(event.groupId(), "Expense removed"))
                .thenReturn("Weekend trip · Expense removed");
        listener.expenseChanged(mapper.writeValueAsString(event));
        verify(writer)
                .save(
                        eq(payer),
                        eq("EXPENSE_DELETED"),
                        anyString(),
                        anyString(),
                        eq(event.groupId()),
                        isNull(),
                        eq(event.expenseId()));
    }
}
