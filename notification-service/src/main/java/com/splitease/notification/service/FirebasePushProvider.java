package com.splitease.notification.service;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.*;
import com.google.firebase.messaging.*;
import com.splitease.notification.domain.Notification;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

@Component
@ConditionalOnProperty(prefix = "notifications.push", name = "enabled", havingValue = "true")
public class FirebasePushProvider implements PushProvider {
    private final FirebaseMessaging messaging;

    public FirebasePushProvider(@Value("${FIREBASE_PROJECT_ID:}") String project)
            throws java.io.IOException {
        if (project.isBlank())
            throw new IllegalStateException("Firebase project is required for push delivery");
        FirebaseApp app =
                FirebaseApp.initializeApp(
                        FirebaseOptions.builder()
                                .setProjectId(project)
                                .setCredentials(GoogleCredentials.getApplicationDefault())
                                .build(),
                        "splitease-notifications");
        messaging = FirebaseMessaging.getInstance(app);
    }

    @Override
    public void deliver(String token, Notification notification) {
        Map<String, String> data = new HashMap<>();
        data.put("notificationId", notification.getId().toString());
        data.put("userId", notification.getUserId().toString());
        data.put("title", notification.getTitle());
        data.put("message", notification.getMessage());
        data.put("type", notification.getType());
        if (notification.getGroupId() != null)
            data.put("groupId", notification.getGroupId().toString());
        if (notification.getInvitationId() != null)
            data.put("invitationId", notification.getInvitationId().toString());
        if (notification.getExpenseId() != null)
            data.put("expenseId", notification.getExpenseId().toString());
        try {
            // Data-only delivery allows the device to reject a stale account's notification before
            // display.
            messaging.send(
                    Message.builder()
                            .setToken(token)
                            .putAllData(data)
                            .setAndroidConfig(
                                    AndroidConfig.builder()
                                            .setPriority(AndroidConfig.Priority.HIGH)
                                            .build())
                            .build());
        } catch (FirebaseMessagingException failure) {
            throw new IllegalStateException(
                    "Firebase push delivery failed: " + failure.getMessagingErrorCode());
        }
    }
}
