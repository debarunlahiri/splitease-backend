package com.splitease.group.service;

import com.splitease.common.api.GroupMembershipSnapshot;
import com.splitease.common.api.PageLimits;
import com.splitease.common.api.PageResponse;
import com.splitease.common.exception.NotFoundException;
import com.splitease.group.domain.ExpenseGroup;
import com.splitease.group.dto.GroupDtos;
import com.splitease.group.repository.ExpenseGroupRepository;

import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class GroupService {
    private final ExpenseGroupRepository groups;
    private final MemberProfileClient profiles;

    public GroupService(ExpenseGroupRepository groups, MemberProfileClient profiles) {
        this.groups = groups;
        this.profiles = profiles;
    }

    @Transactional
    public GroupDtos.View create(UUID userId, GroupDtos.Create request) {
        ExpenseGroup group =
                groups.save(new ExpenseGroup(request.name(), request.defaultCurrency(), userId));
        return view(group, profiles.names(java.util.List.of(userId)));
    }

    @Transactional(readOnly = true)
    public PageResponse<GroupDtos.View> list(UUID userId, int page, int size) {
        var pageResult =
                groups.findDistinctByMembersUserId(
                        userId,
                        PageLimits.request(
                                page,
                                size,
                                Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"))));
        var ids =
                pageResult.stream()
                        .flatMap(group -> group.getMembers().stream())
                        .map(member -> member.getUserId())
                        .collect(java.util.stream.Collectors.toSet());
        var names = profiles.names(ids);
        return PageResponse.from(pageResult.map(group -> view(group, names)));
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

    @Transactional(readOnly = true)
    public String groupName(UUID groupId) {
        return required(groupId).getName();
    }

    private ExpenseGroup required(UUID groupId) {
        return groups.findById(groupId).orElseThrow(() -> new NotFoundException("Group not found"));
    }

    private GroupDtos.View view(ExpenseGroup group, java.util.Map<UUID, String> names) {
        return new GroupDtos.View(
                group.getId(),
                group.getName(),
                group.getDefaultCurrency(),
                group.getCreatedBy(),
                group.getCreatedAt(),
                group.getMembers().stream()
                        .map(
                                member ->
                                        new GroupDtos.Member(
                                                member.getUserId(),
                                                member.getRole(),
                                                member.getJoinedAt(),
                                                names.get(member.getUserId())))
                        .toList());
    }
}
