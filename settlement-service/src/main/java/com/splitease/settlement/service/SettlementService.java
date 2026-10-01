package com.splitease.settlement.service;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.splitease.common.event.SettlementRecordedEvent;
import com.splitease.common.api.PageLimits;
import com.splitease.common.api.PageResponse;
import com.splitease.settlement.domain.Settlement;
import com.splitease.settlement.dto.SettlementDtos;
import com.splitease.settlement.repository.SettlementRepository;
import org.springframework.stereotype.Service;
import org.springframework.data.domain.Sort;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SettlementService {
    private final SettlementRepository settlements;
    private final GroupMembershipClient groupMembership;
    private final OutboxService outbox;

    public SettlementService(
            SettlementRepository settlements,
            GroupMembershipClient groupMembership,
            OutboxService outbox) {
        this.settlements = settlements;
        this.groupMembership = groupMembership;
        this.outbox = outbox;
    }

    @Transactional
    public SettlementDtos.View record(UUID payerId, SettlementDtos.Create request) {
        if (payerId.equals(request.payeeId())) {
            throw new IllegalArgumentException("Payer and payee must be different users");
        }
        groupMembership.requireMembers(request.groupId(), List.of(payerId, request.payeeId()));
        Settlement saved = settlements.save(new Settlement(request.groupId(), payerId, request.payeeId(),
                request.amount(), request.currency(), request.note()));
        SettlementRecordedEvent event = new SettlementRecordedEvent(
                UUID.randomUUID(), saved.getId(), saved.getGroupId(), saved.getPayerId(), saved.getPayeeId(),
                saved.getAmount(), saved.getCurrency(), Instant.now());
        outbox.append("settlement.recorded", saved.getGroupId().toString(), saved.getId(), event);
        return view(saved);
    }

    @Transactional(readOnly = true)
    public PageResponse<SettlementDtos.View> byGroup(
            UUID currentUserId, UUID groupId, int page, int size) {
        groupMembership.requireMember(groupId, currentUserId);
        return PageResponse.from(settlements.findByGroupId(groupId,
                PageLimits.request(page, size, Sort.by(Sort.Order.desc("createdAt"),
                        Sort.Order.desc("id")))).map(this::view));
    }

    private SettlementDtos.View view(Settlement value) {
        return new SettlementDtos.View(value.getId(), value.getGroupId(), value.getPayerId(), value.getPayeeId(),
                value.getAmount(), value.getCurrency(), value.getNote(), value.getCreatedAt());
    }
}
