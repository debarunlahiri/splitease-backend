package com.splitease.group.service;

import java.util.UUID;

import com.splitease.common.api.GroupMembershipSnapshot;
import com.splitease.common.api.PageLimits;
import com.splitease.common.api.PageResponse;
import com.splitease.common.exception.NotFoundException;
import com.splitease.group.domain.ExpenseGroup;
import com.splitease.group.dto.GroupDtos;
import com.splitease.group.repository.ExpenseGroupRepository;
import org.springframework.stereotype.Service;
import org.springframework.data.domain.Sort;
import org.springframework.transaction.annotation.Transactional;

@Service
public class GroupService {
    private final ExpenseGroupRepository groups;

    public GroupService(ExpenseGroupRepository groups) {
        this.groups = groups;
    }

    @Transactional
    public GroupDtos.View create(UUID userId, GroupDtos.Create request) {
        return view(groups.save(new ExpenseGroup(request.name(), request.defaultCurrency(), userId)));
    }

    @Transactional(readOnly = true)
    public PageResponse<GroupDtos.View> list(UUID userId, int page, int size) {
        return PageResponse.from(groups.findDistinctByMembersUserId(userId,
                PageLimits.request(page, size, Sort.by(Sort.Order.desc("createdAt"),
                        Sort.Order.desc("id")))).map(this::view));
    }

    @Transactional(readOnly = true)
    public GroupMembershipSnapshot membership(UUID groupId) {
        ExpenseGroup group = required(groupId);
        return new GroupMembershipSnapshot(
                group.getId(),
                group.getMembers().stream()
                        .map(member -> member.getUserId())
                        .collect(java.util.stream.Collectors.toUnmodifiableSet()));
    }

    private ExpenseGroup required(UUID groupId) {
        return groups.findById(groupId).orElseThrow(() -> new NotFoundException("Group not found"));
    }

    private GroupDtos.View view(ExpenseGroup group) {
        return new GroupDtos.View(group.getId(), group.getName(), group.getDefaultCurrency(),
                group.getCreatedBy(), group.getCreatedAt(), group.getMembers().stream()
                        .map(member -> new GroupDtos.Member(member.getUserId(), member.getRole(), member.getJoinedAt()))
                        .toList());
    }
}
