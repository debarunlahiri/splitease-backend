package com.splitease.group.controller;

import com.splitease.common.api.GroupMembershipSnapshot;
import com.splitease.group.service.GroupService;
import com.splitease.group.service.InternalServiceAuthorizer;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/internal/v1/groups")
public class InternalGroupController {
    private final GroupService groupService;
    private final InternalServiceAuthorizer authorizer;

    public InternalGroupController(
            GroupService groupService, InternalServiceAuthorizer authorizer) {
        this.groupService = groupService;
        this.authorizer = authorizer;
    }

    public record GroupSummary(UUID groupId, String name) {}

    @GetMapping("/{groupId}/summary")
    public GroupSummary summary(
            @RequestHeader(value = "X-Service-Key", required = false) String serviceKey,
            @PathVariable UUID groupId) {
        authorizer.requireValid(serviceKey);
        return new GroupSummary(groupId, groupService.groupName(groupId));
    }

    @GetMapping("/{groupId}/membership")
    public GroupMembershipSnapshot membership(
            @RequestHeader(value = "X-Service-Key", required = false) String serviceKey,
            @PathVariable UUID groupId) {
        authorizer.requireValid(serviceKey);
        return groupService.membership(groupId);
    }
}
