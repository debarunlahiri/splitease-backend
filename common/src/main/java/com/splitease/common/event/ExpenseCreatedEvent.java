package com.splitease.common.event;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ExpenseCreatedEvent(
        UUID eventId,
        UUID expenseId,
        UUID groupId,
        UUID paidBy,
        BigDecimal amount,
        String currency,
        List<Share> shares,
        Instant occurredAt) {
    public ExpenseCreatedEvent {
        shares = List.copyOf(shares);
    }

    public record Share(UUID userId, BigDecimal amount) {
    }
}
