package com.splitease.expense.controller;

import java.util.List;
import java.util.UUID;

import com.splitease.expense.dto.ExpenseDtos;
import com.splitease.expense.service.ExpenseService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
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
    public List<ExpenseDtos.View> byGroup(
            @RequestHeader("X-User-Id") UUID userId,
            @PathVariable UUID groupId) {
        return expenseService.byGroup(userId, groupId);
    }
}
