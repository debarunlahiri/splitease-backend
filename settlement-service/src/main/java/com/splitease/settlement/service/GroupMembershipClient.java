package com.splitease.settlement.service;

import java.util.Collection;
import java.util.UUID;

import com.splitease.common.api.GroupMembershipSnapshot;
import com.splitease.common.exception.NotFoundException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;

@Component
public class GroupMembershipClient {
    private final RestClient restClient;
    private final String serviceKey;

    public GroupMembershipClient(
            @Value("${clients.group-service.base-url}") String baseUrl,
            @Value("${security.internal.service-key}") String serviceKey) {
        this.restClient = RestClient.builder().baseUrl(baseUrl).build();
        this.serviceKey = serviceKey;
    }

    public void requireMembers(UUID groupId, Collection<UUID> userIds) {
        GroupMembershipSnapshot membership = membership(groupId);
        if (!membership.memberIds().containsAll(userIds)) {
            throw new AccessDeniedException("Every settlement participant must belong to the group");
        }
    }

    public void requireMember(UUID groupId, UUID userId) {
        if (!membership(groupId).contains(userId)) {
            throw new AccessDeniedException("User is not a member of this group");
        }
    }

    private GroupMembershipSnapshot membership(UUID groupId) {
        try {
            GroupMembershipSnapshot response = restClient.get()
                    .uri("/internal/v1/groups/{groupId}/membership", groupId)
                    .header("X-Service-Key", serviceKey)
                    .retrieve()
                    .body(GroupMembershipSnapshot.class);
            if (response == null) {
                throw new IllegalStateException("Groups service returned an empty membership response");
            }
            return response;
        } catch (HttpClientErrorException.NotFound exception) {
            throw new NotFoundException("Group not found");
        }
    }
}

