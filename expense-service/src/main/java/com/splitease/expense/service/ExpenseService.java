package com.splitease.expense.service;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.splitease.common.event.ExpenseChangedEvent;
import com.splitease.common.api.PageLimits;
import com.splitease.common.api.PageResponse;
import com.splitease.common.event.ExpenseCreatedEvent;
import com.splitease.common.exception.NotFoundException;
import com.splitease.expense.domain.Expense;
import com.splitease.expense.domain.ExpenseAudit;
import com.splitease.expense.dto.ExpenseDtos;
import com.splitease.expense.repository.ExpenseAuditRepository;
import com.splitease.expense.repository.ExpenseRepository;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ExpenseService {
    private final ExpenseRepository expenses;
    private final SplitCalculator splitCalculator;
    private final GroupMembershipClient groupMembership;
    private final OutboxService outbox;
    private final ExpenseAuditRepository audits;
    private final ObjectMapper objectMapper;

    public ExpenseService(
            ExpenseRepository expenses,
            SplitCalculator splitCalculator,
            GroupMembershipClient groupMembership,
            OutboxService outbox,
            ExpenseAuditRepository audits,
            ObjectMapper objectMapper) {
        this.expenses = expenses;
        this.splitCalculator = splitCalculator;
        this.groupMembership = groupMembership;
        this.outbox = outbox;
        this.audits = audits;
        this.objectMapper = objectMapper;
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
        setMetadata(expense, request.category(), request.notes(), request.receipt());
        Expense saved = expenses.save(expense);
        ExpenseCreatedEvent event = new ExpenseCreatedEvent(
                UUID.randomUUID(), saved.getId(), saved.getGroupId(), saved.getPaidBy(),
                saved.getAmount(), saved.getCurrency(),
                saved.getShares().stream()
                        .map(share -> new ExpenseCreatedEvent.Share(share.getUserId(), share.getAmount()))
                        .toList(),
                Instant.now());
        outbox.append("expense.created", saved.getGroupId().toString(), saved.getId(), event);
        audit(saved, currentUserId, "CREATED", 0);
        return view(saved);
    }

    @Transactional
    public ExpenseDtos.View update(UUID currentUserId, UUID expenseId, ExpenseDtos.Update request) {
        Expense expense = required(expenseId);
        requireEditor(currentUserId, expense);
        if (!currentUserId.equals(request.paidBy())) {
            throw new AccessDeniedException("The payer must be the editing user");
        }
        List<ExpenseDtos.Share> shares = splitCalculator.calculate(
                request.amount(), request.splitType(), request.shares());
        groupMembership.requireMembers(expense.getGroupId(),
                shares.stream().map(ExpenseDtos.Share::userId).toList());
        ExpenseChangedEvent.Snapshot previous = snapshot(expense);
        long nextRevision = expense.getRevision() + 1;
        expense.edit(request.paidBy(), request.description(), request.amount(),
                request.currency(), request.expenseDate(), request.splitType());
        expenses.flush();
        shares.forEach(share -> expense.addShare(share.userId(), share.value()));
        setMetadata(expense, request.category(), request.notes(), request.receipt());
        outbox.append("expense.changed", expense.getGroupId().toString(), expense.getId(),
                new ExpenseChangedEvent(UUID.randomUUID(), expense.getId(), expense.getGroupId(),
                        nextRevision,
                        previous, snapshot(expense), Instant.now()));
        audit(expense, currentUserId, "UPDATED", nextRevision);
        return view(expense);
    }

    @Transactional
    public void delete(UUID currentUserId, UUID expenseId) {
        Expense expense = required(expenseId);
        requireEditor(currentUserId, expense);
        ExpenseChangedEvent.Snapshot previous = snapshot(expense);
        long nextRevision = expense.getRevision() + 1;
        expense.delete();
        outbox.append("expense.changed", expense.getGroupId().toString(), expense.getId(),
                new ExpenseChangedEvent(UUID.randomUUID(), expense.getId(), expense.getGroupId(),
                        nextRevision,
                        previous, null, Instant.now()));
        audit(expense, currentUserId, "DELETED", nextRevision);
    }

    @Transactional(readOnly = true)
    public PageResponse<ExpenseDtos.AuditView> history(
            UUID currentUserId, UUID expenseId, int page, int size) {
        Expense expense = expenses.findById(expenseId)
                .orElseThrow(() -> new NotFoundException("Expense not found"));
        groupMembership.requireMember(expense.getGroupId(), currentUserId);
        return PageResponse.from(audits.findByExpenseId(expenseId,
                        PageLimits.request(page, size, Sort.by("revision").ascending()))
                .map(audit -> new ExpenseDtos.AuditView(audit.getId(), audit.getActorId(),
                        audit.getAction(), audit.getRevision(), audit.getSnapshot(),
                        audit.getOccurredAt())));
    }

    @Transactional(readOnly = true)
    public PageResponse<ExpenseDtos.View> byGroup(
            UUID currentUserId, UUID groupId, int page, int size) {
        groupMembership.requireMember(groupId, currentUserId);
        return PageResponse.from(expenses.findByGroupIdAndDeletedAtIsNull(groupId,
                PageLimits.request(page, size, Sort.by(Sort.Order.desc("expenseDate"),
                        Sort.Order.desc("createdAt"), Sort.Order.desc("id")))).map(this::view));
    }

    private Expense required(UUID expenseId) {
        Expense expense = expenses.findLockedById(expenseId)
                .orElseThrow(() -> new NotFoundException("Expense not found"));
        if (expense.getDeletedAt() != null) {
            throw new NotFoundException("Expense not found");
        }
        return expense;
    }

    private void requireEditor(UUID userId, Expense expense) {
        groupMembership.requireMember(expense.getGroupId(), userId);
        if (!expense.getPaidBy().equals(userId)) {
            throw new AccessDeniedException("Only the payer can change this expense");
        }
    }

    private void setMetadata(Expense expense, String category, String notes, ExpenseDtos.Receipt receipt) {
        expense.setMetadata(category, notes, receipt == null ? null : receipt.name(),
                receipt == null ? null : receipt.contentType(),
                receipt == null ? null : receipt.storageKey());
    }

    private ExpenseChangedEvent.Snapshot snapshot(Expense expense) {
        return new ExpenseChangedEvent.Snapshot(expense.getPaidBy(), expense.getAmount(),
                expense.getCurrency(), expense.getShares().stream()
                        .map(share -> new ExpenseChangedEvent.Share(share.getUserId(), share.getAmount()))
                        .toList());
    }

    private void audit(Expense expense, UUID actorId, String action, long revision) {
        try {
            audits.save(new ExpenseAudit(expense.getId(), expense.getGroupId(), actorId,
                    action, revision, objectMapper.writeValueAsString(view(expense))));
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Could not record expense audit", exception);
        }
    }

    private ExpenseDtos.View view(Expense expense) {
        return new ExpenseDtos.View(
                expense.getId(), expense.getGroupId(), expense.getPaidBy(), expense.getDescription(),
                expense.getAmount(), expense.getCurrency(), expense.getExpenseDate(), expense.getSplitType(),
                expense.getShares().stream().map(s -> new ExpenseDtos.Share(s.getUserId(), s.getAmount())).toList(),
                expense.getCreatedAt(), expense.getUpdatedAt(), expense.getCategory(),
                expense.getNotes(), expense.getReceiptStorageKey() == null ? null
                        : new ExpenseDtos.Receipt(expense.getReceiptName(),
                                expense.getReceiptContentType(), expense.getReceiptStorageKey()),
                expense.getRevision());
    }
}
