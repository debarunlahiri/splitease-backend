package com.splitease.expense.domain;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "outbox_events")
public class OutboxEvent {
    @Id private UUID id;
    @Column(nullable = false) private UUID aggregateId;
    @Column(nullable = false, length = 80) private String eventType;
    @Column(nullable = false, length = 120) private String topic;
    @Column(nullable = false, length = 160) private String eventKey;
    @Column(nullable = false, columnDefinition = "text") private String payload;
    @Column(nullable = false, updatable = false) private Instant createdAt;
    private Instant publishedAt;

    protected OutboxEvent() {
    }

    public OutboxEvent(UUID aggregateId, String eventType, String topic, String eventKey, String payload) {
        this.id = UUID.randomUUID();
        this.aggregateId = aggregateId;
        this.eventType = eventType;
        this.topic = topic;
        this.eventKey = eventKey;
        this.payload = payload;
        this.createdAt = Instant.now();
    }

    public void markPublished() { this.publishedAt = Instant.now(); }
    public UUID getId() { return id; }
    public String getTopic() { return topic; }
    public String getEventKey() { return eventKey; }
    public String getPayload() { return payload; }
}

