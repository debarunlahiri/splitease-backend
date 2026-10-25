package com.splitease.notification.service;

import com.splitease.common.event.InvitationCreatedEvent;
import com.splitease.notification.domain.PendingInvitationAlert;
import com.splitease.notification.repository.PendingInvitationAlertRepository;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.*;

import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

@Service
public class InvitationAlertService {
    private final PendingInvitationAlertRepository pending;
    private final NotificationWriter writer;
    private final RestClient identity;
    private final String key;

    public InvitationAlertService(
            PendingInvitationAlertRepository pending,
            NotificationWriter writer,
            @Value("${clients.identity-service.base-url:http://localhost:9891}") String url,
            @Value("${INTERNAL_SERVICE_KEY:replace-with-an-internal-service-key}") String key) {
        this.pending = pending;
        this.writer = writer;
        this.key = key;
        var factory =
                new JdkClientHttpRequestFactory(
                        HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(2)).build());
        factory.setReadTimeout(Duration.ofSeconds(3));
        identity = RestClient.builder().baseUrl(url).requestFactory(factory).build();
    }

    public void received(InvitationCreatedEvent event) {
        PendingInvitationAlert alert = pending.save(new PendingInvitationAlert(event));
        try {
            Profile user =
                    identity.post()
                            .uri("/internal/v1/users/by-email")
                            .header("X-Service-Key", key)
                            .body(Map.of("email", event.inviteeEmail()))
                            .retrieve()
                            .body(Profile.class);
            if (user != null) deliver(alert, user.userId());
        } catch (HttpClientErrorException.NotFound unregistered) {
            // Keep the pending row for the recipient's first authenticated inbox request.
        }
    }

    @Transactional
    public void deliverPending(UUID userId, String email) {
        pending.undelivered(email.trim().toLowerCase(Locale.ROOT))
                .forEach(alert -> deliver(alert, userId));
    }

    private void deliver(PendingInvitationAlert alert, UUID userId) {
        if (alert.getExpiresAt().isAfter(Instant.now())) {
            writer.save(
                    userId,
                    "GROUP_INVITATION",
                    "You're invited",
                    "You've been invited to " + alert.getGroupName() + ".",
                    alert.getGroupId(),
                    alert.getInvitationId(),
                    null);
        }
        alert.delivered(userId);
    }

    private record Profile(UUID userId, String displayName) {}
}
