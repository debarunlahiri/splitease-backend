package com.splitease.expense.controller;

import java.util.UUID;

import com.splitease.expense.dto.ExpenseDtos;
import com.splitease.common.api.PageResponse;
import com.splitease.expense.service.ExpenseService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/expenses")
public class ExpenseController {
    private final ExpenseService expenseService;

    public ExpenseController(ExpenseService expenseService) { this.expenseService = expenseService; }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ExpenseDtos.View create(@RequestHeader("X-User-Id") UUID userId,
                                   @Valid @RequestBody ExpenseDtos.Create request) {
        return expenseService.create(userId, request);
    }

    @GetMapping("/group/{groupId}")
    public PageResponse<ExpenseDtos.View> byGroup(
            @RequestHeader("X-User-Id") UUID userId,
            @PathVariable UUID groupId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return expenseService.byGroup(userId, groupId, page, size);
    }

    @PutMapping("/{expenseId}")
    public ExpenseDtos.View update(
            @RequestHeader("X-User-Id") UUID userId,
            @PathVariable UUID expenseId,
            @Valid @RequestBody ExpenseDtos.Update request) {
        return expenseService.update(userId, expenseId, request);
    }

    @DeleteMapping("/{expenseId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@RequestHeader("X-User-Id") UUID userId, @PathVariable UUID expenseId) {
        expenseService.delete(userId, expenseId);
    }

    @GetMapping("/{expenseId}/history")
    public PageResponse<ExpenseDtos.AuditView> history(
            @RequestHeader("X-User-Id") UUID userId,
            @PathVariable UUID expenseId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return expenseService.history(userId, expenseId, page, size);
    }
}
