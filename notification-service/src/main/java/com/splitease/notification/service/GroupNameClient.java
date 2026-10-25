package com.splitease.notification.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.UUID;

@Component
public class GroupNameClient {
    private final RestClient client;
    private final String key;

    public GroupNameClient(
            @Value("${clients.group-service.base-url:http://localhost:9892}") String url,
            @Value("${INTERNAL_SERVICE_KEY:replace-with-an-internal-service-key}") String key) {
        this.key = key;
        var factory =
                new JdkClientHttpRequestFactory(
                        HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build());
        factory.setReadTimeout(Duration.ofSeconds(3));
        client = RestClient.builder().baseUrl(url).requestFactory(factory).build();
    }

    public String title(UUID groupId, String action) {
        try {
            GroupSummary group =
                    client.get()
                            .uri("/internal/v1/groups/{id}/summary", groupId)
                            .header("X-Service-Key", key)
                            .retrieve()
                            .body(GroupSummary.class);
            if (group == null || group.name() == null || group.name().isBlank()) {
                throw new IllegalStateException("Missing group summary");
            }
            return group.name() + " · " + action;
        } catch (HttpClientErrorException.NotFound deleted) {
            return "Former group · " + action;
        }
    }

    private record GroupSummary(UUID groupId, String name) {}
}
