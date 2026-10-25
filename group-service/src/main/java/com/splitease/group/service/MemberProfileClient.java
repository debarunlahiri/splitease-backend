package com.splitease.group.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
public class MemberProfileClient {
    private final RestClient client;
    private final String key;

    public MemberProfileClient(
            @Value("${clients.identity-service.base-url:http://localhost:9891}") String url,
            @Value("${security.internal.service-key}") String key) {
        this.key = key;
        var factory =
                new JdkClientHttpRequestFactory(
                        HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build());
        factory.setReadTimeout(Duration.ofSeconds(3));
        this.client = RestClient.builder().baseUrl(url).requestFactory(factory).build();
    }

    public Map<UUID, String> names(Collection<UUID> userIds) {
        List<UUID> ids = new ArrayList<>(new java.util.HashSet<>(userIds));
        Map<UUID, String> names = new HashMap<>();
        for (int start = 0; start < ids.size(); start += 200) {
            try {
                List<Profile> profiles =
                        client.post()
                                .uri("/internal/v1/users/profiles")
                                .header("X-Service-Key", key)
                                .body(
                                        Map.of(
                                                "userIds",
                                                ids.subList(
                                                        start, Math.min(start + 200, ids.size()))))
                                .retrieve()
                                .body(new ParameterizedTypeReference<List<Profile>>() {});
                if (profiles != null)
                    profiles.forEach(profile -> names.put(profile.userId(), profile.displayName()));
            } catch (RestClientException unavailable) {
                // Keep group access available without fabricating a name from an internal UUID.
                break;
            }
        }
        return names;
    }

    private record Profile(UUID userId, String displayName) {}
}
