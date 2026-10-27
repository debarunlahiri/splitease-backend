package com.splitease.group.controller;

import com.splitease.group.dto.GroupDtos;
import com.splitease.group.service.GroupInviteLinkService;

import jakarta.validation.Valid;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/groups")
public class GroupInviteLinkController {
    private final GroupInviteLinkService links;

    public GroupInviteLinkController(GroupInviteLinkService links) {
        this.links = links;
    }

    @PostMapping("/{groupId}/invite-links")
    @ResponseStatus(HttpStatus.CREATED)
    public GroupDtos.InviteLink create(
            @RequestHeader("X-User-Id") UUID userId, @PathVariable UUID groupId) {
        return links.create(userId, groupId);
    }

    @PostMapping("/invite-links/join")
    public GroupDtos.JoinedGroup join(
            @RequestHeader("X-User-Id") UUID userId,
            @Valid @RequestBody GroupDtos.JoinLink request) {
        return links.join(userId, request.token());
    }
}
