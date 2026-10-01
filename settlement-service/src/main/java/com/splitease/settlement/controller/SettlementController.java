package com.splitease.settlement.controller;

import java.util.List;
import java.util.UUID;

import com.splitease.settlement.dto.SettlementDtos;
import com.splitease.common.api.PageResponse;
import com.splitease.settlement.service.BalanceQueryService;
import com.splitease.settlement.service.BalanceQueryService.BalanceView;
import com.splitease.settlement.service.SettlementService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/settlements")
public class SettlementController {
    private final SettlementService settlementService;
    private final BalanceQueryService balanceQueryService;

    public SettlementController(
            SettlementService settlementService,
            BalanceQueryService balanceQueryService) {
        this.settlementService = settlementService;
        this.balanceQueryService = balanceQueryService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SettlementDtos.View record(@RequestHeader("X-User-Id") UUID payerId,
                                      @Valid @RequestBody SettlementDtos.Create request) {
        return settlementService.record(payerId, request);
    }

    @GetMapping("/group/{groupId}")
    public PageResponse<SettlementDtos.View> byGroup(
            @RequestHeader("X-User-Id") UUID userId,
            @PathVariable UUID groupId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return settlementService.byGroup(userId, groupId, page, size);
    }

    @GetMapping("/group/{groupId}/balances")
    public List<BalanceView> balances(
            @RequestHeader("X-User-Id") UUID userId,
            @PathVariable UUID groupId,
            @RequestParam String currency) {
        return balanceQueryService.balances(userId, groupId, currency);
    }

    @GetMapping("/group/{groupId}/suggestions")
    public List<SettlementDtos.SuggestedPayment> suggestions(
            @RequestHeader("X-User-Id") UUID userId,
            @PathVariable UUID groupId,
            @RequestParam String currency) {
        return balanceQueryService.suggestions(userId, groupId, currency);
    }
}
