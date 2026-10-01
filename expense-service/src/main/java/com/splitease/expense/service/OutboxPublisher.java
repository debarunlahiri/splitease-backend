package com.splitease.expense.service;

import java.util.concurrent.TimeUnit;

import com.splitease.expense.repository.OutboxEventRepository;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class OutboxPublisher {
    private final OutboxEventRepository outboxEvents;
    private final KafkaTemplate<String, String> kafka;

    public OutboxPublisher(OutboxEventRepository outboxEvents, KafkaTemplate<String, String> kafka) {
        this.outboxEvents = outboxEvents;
        this.kafka = kafka;
    }

    @Scheduled(fixedDelayString = "${outbox.publish-delay:PT2S}")
    @Transactional
    public void publishPendingEvents() {
        outboxEvents.findTop100ByPublishedAtIsNullOrderByCreatedAtAsc().forEach(event -> {
            try {
                kafka.send(event.getTopic(), event.getEventKey(), event.getPayload())
                        .get(10, TimeUnit.SECONDS);
                event.markPublished();
            } catch (Exception exception) {
                throw new IllegalStateException("Could not publish outbox event " + event.getId(), exception);
            }
        });
    }
}

