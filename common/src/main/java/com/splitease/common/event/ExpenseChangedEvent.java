package com.splitease.common.event;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ExpenseChangedEvent(
        UUID eventId,
        UUID expenseId,
        UUID groupId,
        long revision,
        Snapshot previous,
        Snapshot current,
        Instant occurredAt) {
    public record Snapshot(UUID paidBy, BigDecimal amount, String currency, List<Share> shares) {
        public Snapshot {
            shares = List.copyOf(shares);
        }
    }

    public record Share(UUID userId, BigDecimal amount) {
    }
}
