package com.splitease.settlement.service;

import java.util.UUID;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.splitease.settlement.domain.OutboxEvent;
import com.splitease.settlement.repository.OutboxEventRepository;
import org.springframework.stereotype.Service;

@Service
public class OutboxService {
    private final OutboxEventRepository outboxEvents;
    private final ObjectMapper objectMapper;

    public OutboxService(OutboxEventRepository outboxEvents, ObjectMapper objectMapper) {
        this.outboxEvents = outboxEvents;
        this.objectMapper = objectMapper;
    }

    public void append(String topic, String eventKey, UUID aggregateId, Object event) {
        try {
            outboxEvents.save(new OutboxEvent(
                    aggregateId,
                    event.getClass().getSimpleName(),
                    topic,
                    eventKey,
                    objectMapper.writeValueAsString(event)));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Could not serialize the settlement domain event", exception);
        }
    }
}

