package com.splitease.settlement.service;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.splitease.settlement.dto.SettlementDtos;
import org.springframework.stereotype.Component;

@Component
public class DebtSimplifier {
    public List<SettlementDtos.SuggestedPayment> simplify(Map<UUID, BigDecimal> balances, String currency) {
        List<Account> debtors = balances.entrySet().stream()
                .filter(entry -> entry.getValue().signum() < 0)
                .map(entry -> new Account(entry.getKey(), entry.getValue().abs()))
                .sorted(Comparator.comparing(Account::amount).reversed())
                .collect(java.util.stream.Collectors.toCollection(ArrayList::new));
        List<Account> creditors = balances.entrySet().stream()
                .filter(entry -> entry.getValue().signum() > 0)
                .map(entry -> new Account(entry.getKey(), entry.getValue()))
                .sorted(Comparator.comparing(Account::amount).reversed())
                .collect(java.util.stream.Collectors.toCollection(ArrayList::new));

        List<SettlementDtos.SuggestedPayment> payments = new ArrayList<>();
        int debtorIndex = 0;
        int creditorIndex = 0;
        while (debtorIndex < debtors.size() && creditorIndex < creditors.size()) {
            Account debtor = debtors.get(debtorIndex);
            Account creditor = creditors.get(creditorIndex);
            BigDecimal amount = debtor.amount().min(creditor.amount());
            payments.add(new SettlementDtos.SuggestedPayment(debtor.userId(), creditor.userId(), amount, currency));
            debtors.set(debtorIndex, new Account(debtor.userId(), debtor.amount().subtract(amount)));
            creditors.set(creditorIndex, new Account(creditor.userId(), creditor.amount().subtract(amount)));
            if (debtors.get(debtorIndex).amount().signum() == 0) debtorIndex++;
            if (creditors.get(creditorIndex).amount().signum() == 0) creditorIndex++;
        }
        return payments;
    }

    private record Account(UUID userId, BigDecimal amount) {
    }
}

