package com.splitease.expense.dto;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import com.splitease.expense.domain.SplitType;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class ExpenseDtos {
    private ExpenseDtos() {
    }

    public record Share(@NotNull UUID userId, @DecimalMin("0.00") BigDecimal value) {
    }

    public record Create(@NotNull UUID groupId, @NotNull UUID paidBy,
                         @NotBlank @Size(max = 160) String description,
                         @NotNull @DecimalMin("0.01") BigDecimal amount,
                         @Pattern(regexp = "[A-Za-z]{3}") String currency,
                         @NotNull LocalDate expenseDate, @NotNull SplitType splitType,
                         @NotEmpty List<@Valid Share> shares) {
    }

    public record View(UUID id, UUID groupId, UUID paidBy, String description, BigDecimal amount,
                       String currency, LocalDate expenseDate, SplitType splitType,
                       List<Share> shares, Instant createdAt) {
    }
}

