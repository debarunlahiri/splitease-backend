package com.splitease.group.controller;

import java.util.UUID;

import com.splitease.common.api.GroupMembershipSnapshot;
import com.splitease.group.service.GroupService;
import com.splitease.group.service.InternalServiceAuthorizer;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/v1/groups")
public class InternalGroupController {
    private final GroupService groupService;
    private final InternalServiceAuthorizer authorizer;

    public InternalGroupController(GroupService groupService, InternalServiceAuthorizer authorizer) {
        this.groupService = groupService;
        this.authorizer = authorizer;
    }

    @GetMapping("/{groupId}/membership")
    public GroupMembershipSnapshot membership(
            @RequestHeader(value = "X-Service-Key", required = false) String serviceKey,
            @PathVariable UUID groupId) {
        authorizer.requireValid(serviceKey);
        return groupService.membership(groupId);
    }
}

