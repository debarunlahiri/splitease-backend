package com.splitease.expense.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

import com.splitease.expense.domain.SplitType;
import com.splitease.expense.dto.ExpenseDtos;
import org.springframework.stereotype.Component;

@Component
public class SplitCalculator {
    private static final BigDecimal ONE_HUNDRED = new BigDecimal("100.00");

    public List<ExpenseDtos.Share> calculate(BigDecimal total, SplitType type, List<ExpenseDtos.Share> requested) {
        if (new HashSet<>(requested.stream().map(ExpenseDtos.Share::userId).toList()).size() != requested.size()) {
            throw new IllegalArgumentException("A user can appear only once in an expense split");
        }
        return switch (type) {
            case EQUAL -> equal(total, requested);
            case EXACT -> exact(total, requested);
            case PERCENTAGE -> percentage(total, requested);
        };
    }

    private List<ExpenseDtos.Share> equal(BigDecimal total, List<ExpenseDtos.Share> requested) {
        BigDecimal base = total.divide(BigDecimal.valueOf(requested.size()), 2, RoundingMode.DOWN);
        BigDecimal remainder = total.subtract(base.multiply(BigDecimal.valueOf(requested.size())));
        List<ExpenseDtos.Share> result = new ArrayList<>();
        for (int index = 0; index < requested.size(); index++) {
            BigDecimal amount = index == 0 ? base.add(remainder) : base;
            result.add(new ExpenseDtos.Share(requested.get(index).userId(), amount));
        }
        return result;
    }

    private List<ExpenseDtos.Share> exact(BigDecimal total, List<ExpenseDtos.Share> requested) {
        BigDecimal sum = requested.stream().map(ExpenseDtos.Share::value).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (sum.compareTo(total) != 0) {
            throw new IllegalArgumentException("Exact shares must add up to the expense amount");
        }
        return requested;
    }

    private List<ExpenseDtos.Share> percentage(BigDecimal total, List<ExpenseDtos.Share> requested) {
        BigDecimal percentage = requested.stream()
                .map(ExpenseDtos.Share::value)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        if (percentage.compareTo(ONE_HUNDRED) != 0) {
            throw new IllegalArgumentException("Percentage shares must add up to 100");
        }
        List<ExpenseDtos.Share> result = new ArrayList<>();
        BigDecimal assigned = BigDecimal.ZERO;
        for (int index = 0; index < requested.size(); index++) {
            BigDecimal amount = index == requested.size() - 1
                    ? total.subtract(assigned)
                    : total.multiply(requested.get(index).value()).divide(ONE_HUNDRED, 2, RoundingMode.HALF_UP);
            assigned = assigned.add(amount);
            result.add(new ExpenseDtos.Share(requested.get(index).userId(), amount));
        }
        return result;
    }
}
