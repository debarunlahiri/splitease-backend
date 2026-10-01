package com.splitease.notification.domain;

import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "notification_preferences")
public class NotificationPreference {
    @Id
    private UUID userId;
    @Column(nullable = false)
    private boolean inboxEnabled;
    @Column(nullable = false)
    private boolean pushEnabled;
    @Column(length = 500)
    private String pushToken;

    protected NotificationPreference() {
    }

    public NotificationPreference(UUID userId) {
        this.userId = userId;
        this.inboxEnabled = true;
        this.pushEnabled = false;
    }

    public UUID getUserId() { return userId; }
    public boolean isInboxEnabled() { return inboxEnabled; }
    public boolean isPushEnabled() { return pushEnabled; }
    public String getPushToken() { return pushToken; }

    public void update(boolean inboxEnabled, boolean pushEnabled, String pushToken) {
        this.inboxEnabled = inboxEnabled;
        this.pushEnabled = pushEnabled;
        this.pushToken = pushToken;
    }
}
