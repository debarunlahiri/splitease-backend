package com.splitease.settlement.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class SettlementDtos {
    private SettlementDtos() {
    }

    public record Create(@NotNull UUID groupId, @NotNull UUID payeeId,
                         @NotNull @DecimalMin("0.01") BigDecimal amount,
                         @Pattern(regexp = "[A-Za-z]{3}") String currency,
                         @Size(max = 160) String note) {
    }

    public record View(UUID id, UUID groupId, UUID payerId, UUID payeeId,
                       BigDecimal amount, String currency, String note, Instant createdAt) {
    }

    public record SuggestedPayment(UUID fromUserId, UUID toUserId, BigDecimal amount, String currency) {
    }
}

