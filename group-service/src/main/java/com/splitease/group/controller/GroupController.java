package com.splitease.group.controller;

import java.util.UUID;

import com.splitease.group.dto.GroupDtos;
import com.splitease.common.api.PageResponse;
import com.splitease.group.service.GroupService;
import com.splitease.group.service.GroupInvitationService;
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
@RequestMapping("/api/v1/groups")
public class GroupController {
    private final GroupService groupService;
    private final GroupInvitationService invitations;

    public GroupController(GroupService groupService, GroupInvitationService invitations) {
        this.groupService = groupService;
        this.invitations = invitations;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public GroupDtos.View create(
            @RequestHeader("X-User-Id") UUID userId,
            @Valid @RequestBody GroupDtos.Create request) {
        return groupService.create(userId, request);
    }

    @GetMapping
    public PageResponse<GroupDtos.View> list(
            @RequestHeader("X-User-Id") UUID userId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return groupService.list(userId, page, size);
    }

    @PostMapping("/{groupId}/invitations")
    @ResponseStatus(HttpStatus.CREATED)
    public GroupDtos.InvitationView invite(
            @RequestHeader("X-User-Id") UUID userId,
            @PathVariable UUID groupId,
            @Valid @RequestBody GroupDtos.Invite request) {
        return invitations.create(userId, groupId, request);
    }

    @GetMapping("/{groupId}/invitations")
    public PageResponse<GroupDtos.InvitationView> groupInvitations(
            @RequestHeader("X-User-Id") UUID userId,
            @PathVariable UUID groupId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return invitations.forGroup(userId, groupId, page, size);
    }

    @GetMapping("/invitations/me")
    public PageResponse<GroupDtos.InvitationView> myInvitations(
            @RequestHeader("X-User-Id") UUID userId,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return invitations.inbox(userId, page, size);
    }

    @PostMapping("/invitations/{invitationId}/accept")
    public GroupDtos.InvitationView accept(
            @RequestHeader("X-User-Id") UUID userId,
            @PathVariable UUID invitationId) {
        return invitations.accept(userId, invitationId);
    }

    @PostMapping("/invitations/{invitationId}/decline")
    public GroupDtos.InvitationView decline(
            @RequestHeader("X-User-Id") UUID userId,
            @PathVariable UUID invitationId) {
        return invitations.decline(userId, invitationId);
    }

    @PostMapping("/invitations/{invitationId}/revoke")
    public GroupDtos.InvitationView revoke(
            @RequestHeader("X-User-Id") UUID userId,
            @PathVariable UUID invitationId) {
        return invitations.revoke(userId, invitationId);
    }
}
