package com.splitease.settlement.service;

import java.math.BigDecimal;
import java.util.UUID;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.splitease.common.event.ExpenseCreatedEvent;
import com.splitease.common.event.ExpenseChangedEvent;
import com.splitease.common.event.SettlementRecordedEvent;
import com.splitease.settlement.domain.ProcessedEvent;
import com.splitease.settlement.domain.ExpenseProjection;
import com.splitease.settlement.repository.GroupBalanceRepository;
import com.splitease.settlement.repository.ExpenseProjectionRepository;
import com.splitease.settlement.repository.ProcessedEventRepository;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import jakarta.persistence.EntityManager;

@Component
public class BalanceProjectionListener {
    private final GroupBalanceRepository balances;
    private final ProcessedEventRepository processedEvents;
    private final ObjectMapper objectMapper;
    private final ExpenseProjectionRepository expenseProjections;
    private final EntityManager entityManager;

    public BalanceProjectionListener(
            GroupBalanceRepository balances,
            ProcessedEventRepository processedEvents,
            ObjectMapper objectMapper,
            ExpenseProjectionRepository expenseProjections,
            EntityManager entityManager) {
        this.balances = balances;
        this.processedEvents = processedEvents;
        this.objectMapper = objectMapper;
        this.expenseProjections = expenseProjections;
        this.entityManager = entityManager;
    }

    @KafkaListener(topics = "expense.created", groupId = "settlement-balance-projection")
    @Transactional
    public void expenseCreated(String payload) {
        ExpenseCreatedEvent event = read(payload, ExpenseCreatedEvent.class);
        if (processedEvents.existsById(event.eventId())) {
            return;
        }

        ExpenseChangedEvent.Snapshot snapshot = new ExpenseChangedEvent.Snapshot(
                event.paidBy(), event.amount(), event.currency(),
                event.shares().stream()
                        .map(share -> new ExpenseChangedEvent.Share(share.userId(), share.amount()))
                        .toList());
        project(event.expenseId(), event.groupId(), 0, snapshot);
        processedEvents.save(new ProcessedEvent(event.eventId(), ExpenseCreatedEvent.class.getSimpleName()));
    }

    @KafkaListener(topics = "expense.changed", groupId = "settlement-balance-projection")
    @Transactional
    public void expenseChanged(String payload) {
        ExpenseChangedEvent event = read(payload, ExpenseChangedEvent.class);
        if (processedEvents.existsById(event.eventId())) {
            return;
        }
        project(event.expenseId(), event.groupId(), event.revision(), event.current());
        processedEvents.save(new ProcessedEvent(event.eventId(), ExpenseChangedEvent.class.getSimpleName()));
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

    private void project(UUID expenseId, UUID groupId, long revision,
                         ExpenseChangedEvent.Snapshot current) {
        entityManager.createNativeQuery("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))")
                .setParameter("key", "expense-projection:" + expenseId)
                .getSingleResult();
        ExpenseProjection projection = expenseProjections.findById(expenseId).orElse(null);
        if (projection != null && projection.getRevision() >= revision) {
            return;
        }
        ExpenseChangedEvent.Snapshot previous = projection == null || projection.getSnapshot() == null
                ? null : read(projection.getSnapshot(), ExpenseChangedEvent.Snapshot.class);
        apply(groupId, previous, false);
        apply(groupId, current, true);
        String serialized = current == null ? null : write(current);
        if (projection == null) {
            expenseProjections.save(new ExpenseProjection(expenseId, groupId, revision, serialized));
        } else {
            projection.replace(revision, serialized);
        }
    }

    private void apply(UUID groupId, ExpenseChangedEvent.Snapshot snapshot, boolean forward) {
        if (snapshot == null) {
            return;
        }
        BigDecimal multiplier = forward ? BigDecimal.ONE : BigDecimal.ONE.negate();
        adjust(groupId, snapshot.paidBy(), snapshot.currency(), snapshot.amount().multiply(multiplier));
        snapshot.shares().forEach(share -> adjust(groupId, share.userId(), snapshot.currency(),
                share.amount().multiply(multiplier).negate()));
    }

    private String write(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Could not store expense projection", exception);
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
