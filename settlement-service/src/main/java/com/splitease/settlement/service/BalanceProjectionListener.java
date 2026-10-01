package com.splitease.settlement.service;

import java.math.BigDecimal;
import java.util.UUID;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.splitease.common.event.ExpenseCreatedEvent;
import com.splitease.common.event.SettlementRecordedEvent;
import com.splitease.settlement.domain.ProcessedEvent;
import com.splitease.settlement.repository.GroupBalanceRepository;
import com.splitease.settlement.repository.ProcessedEventRepository;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class BalanceProjectionListener {
    private final GroupBalanceRepository balances;
    private final ProcessedEventRepository processedEvents;
    private final ObjectMapper objectMapper;

    public BalanceProjectionListener(
            GroupBalanceRepository balances,
            ProcessedEventRepository processedEvents,
            ObjectMapper objectMapper) {
        this.balances = balances;
        this.processedEvents = processedEvents;
        this.objectMapper = objectMapper;
    }

    @KafkaListener(topics = "expense.created", groupId = "settlement-balance-projection")
    @Transactional
    public void expenseCreated(String payload) {
        ExpenseCreatedEvent event = read(payload, ExpenseCreatedEvent.class);
        if (processedEvents.existsById(event.eventId())) {
            return;
        }

        adjust(event.groupId(), event.paidBy(), event.currency(), event.amount());
        event.shares().forEach(share -> adjust(
                event.groupId(),
                share.userId(),
                event.currency(),
                share.amount().negate()));
        processedEvents.save(new ProcessedEvent(event.eventId(), ExpenseCreatedEvent.class.getSimpleName()));
    }

    @KafkaListener(topics = "settlement.recorded", groupId = "settlement-balance-projection")
    @Transactional
    public void settlementRecorded(String payload) {
        SettlementRecordedEvent event = read(payload, SettlementRecordedEvent.class);
        if (processedEvents.existsById(event.eventId())) {
            return;
        }

        adjust(event.groupId(), event.payerId(), event.currency(), event.amount());
        adjust(event.groupId(), event.payeeId(), event.currency(), event.amount().negate());
        processedEvents.save(new ProcessedEvent(event.eventId(), SettlementRecordedEvent.class.getSimpleName()));
    }

    private void adjust(UUID groupId, UUID userId, String currency, BigDecimal delta) {
        balances.adjust(UUID.randomUUID(), groupId, userId, currency, delta);
    }

    private <T> T read(String payload, Class<T> eventType) {
        try {
            return objectMapper.readValue(payload, eventType);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Invalid " + eventType.getSimpleName() + " payload", exception);
        }
    }
}
