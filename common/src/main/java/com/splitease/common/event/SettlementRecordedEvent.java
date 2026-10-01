package com.splitease.common.event;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record SettlementRecordedEvent(
        UUID eventId,
        UUID settlementId,
        UUID groupId,
        UUID payerId,
        UUID payeeId,
        BigDecimal amount,
        String currency,
        Instant occurredAt) {
}

