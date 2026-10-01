package com.splitease.settlement.service;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

import com.splitease.settlement.dto.SettlementDtos;
import com.splitease.settlement.repository.GroupBalanceRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class BalanceQueryService {
    private final GroupBalanceRepository balances;
    private final GroupMembershipClient groupMembership;
    private final DebtSimplifier debtSimplifier;

    public BalanceQueryService(
            GroupBalanceRepository balances,
            GroupMembershipClient groupMembership,
            DebtSimplifier debtSimplifier) {
        this.balances = balances;
        this.groupMembership = groupMembership;
        this.debtSimplifier = debtSimplifier;
    }

    @Transactional(readOnly = true)
    public List<BalanceView> balances(UUID currentUserId, UUID groupId, String currency) {
        groupMembership.requireMember(groupId, currentUserId);
        return balances.findByGroupIdAndCurrencyOrderByUserId(groupId, normalize(currency)).stream()
                .map(value -> new BalanceView(
                        value.getUserId(),
                        value.getAmount(),
                        value.getCurrency(),
                        value.getUpdatedAt()))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<SettlementDtos.SuggestedPayment> suggestions(
            UUID currentUserId,
            UUID groupId,
            String currency) {
        List<BalanceView> currentBalances = balances(currentUserId, groupId, currency);
        Map<UUID, BigDecimal> amounts = currentBalances.stream()
                .collect(Collectors.toMap(BalanceView::userId, BalanceView::amount));
        return debtSimplifier.simplify(amounts, normalize(currency));
    }

    private String normalize(String currency) {
        if (currency == null || !currency.matches("[A-Za-z]{3}")) {
            throw new IllegalArgumentException("Currency must be a three-letter ISO code");
        }
        return currency.toUpperCase(java.util.Locale.ROOT);
    }

    public record BalanceView(UUID userId, BigDecimal amount, String currency, Instant updatedAt) {
    }
}
