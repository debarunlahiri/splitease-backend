package com.splitease.expense.service;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.splitease.common.event.ExpenseCreatedEvent;
import com.splitease.expense.domain.Expense;
import com.splitease.expense.dto.ExpenseDtos;
import com.splitease.expense.repository.ExpenseRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ExpenseService {
    private final ExpenseRepository expenses;
    private final SplitCalculator splitCalculator;
    private final GroupMembershipClient groupMembership;
    private final OutboxService outbox;

    public ExpenseService(
            ExpenseRepository expenses,
            SplitCalculator splitCalculator,
            GroupMembershipClient groupMembership,
            OutboxService outbox) {
        this.expenses = expenses;
        this.splitCalculator = splitCalculator;
        this.groupMembership = groupMembership;
        this.outbox = outbox;
    }

    @Transactional
    public ExpenseDtos.View create(UUID currentUserId, ExpenseDtos.Create request) {
        if (!currentUserId.equals(request.paidBy())) {
            throw new IllegalArgumentException("The payer must be the authenticated user");
        }
        groupMembership.requireMember(request.groupId(), currentUserId);
        List<ExpenseDtos.Share> shares = splitCalculator.calculate(
                request.amount(),
                request.splitType(),
                request.shares());
        groupMembership.requireMembers(
                request.groupId(),
                shares.stream().map(ExpenseDtos.Share::userId).toList());
        Expense expense = new Expense(request.groupId(), request.paidBy(), request.description(), request.amount(),
                request.currency(), request.expenseDate(), request.splitType());
        shares.forEach(share -> expense.addShare(share.userId(), share.value()));
        Expense saved = expenses.save(expense);
        ExpenseCreatedEvent event = new ExpenseCreatedEvent(
                UUID.randomUUID(), saved.getId(), saved.getGroupId(), saved.getPaidBy(),
                saved.getAmount(), saved.getCurrency(),
                saved.getShares().stream()
                        .map(share -> new ExpenseCreatedEvent.Share(share.getUserId(), share.getAmount()))
                        .toList(),
                Instant.now());
        outbox.append("expense.created", saved.getGroupId().toString(), saved.getId(), event);
        return view(saved);
    }

    @Transactional(readOnly = true)
    public List<ExpenseDtos.View> byGroup(UUID currentUserId, UUID groupId) {
        groupMembership.requireMember(groupId, currentUserId);
        return expenses.findByGroupIdOrderByExpenseDateDescCreatedAtDesc(groupId).stream().map(this::view).toList();
    }

    private ExpenseDtos.View view(Expense expense) {
        return new ExpenseDtos.View(
                expense.getId(), expense.getGroupId(), expense.getPaidBy(), expense.getDescription(),
                expense.getAmount(), expense.getCurrency(), expense.getExpenseDate(), expense.getSplitType(),
                expense.getShares().stream().map(s -> new ExpenseDtos.Share(s.getUserId(), s.getAmount())).toList(),
                expense.getCreatedAt());
    }
}
