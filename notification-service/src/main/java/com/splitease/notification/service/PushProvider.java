package com.splitease.notification.service;

import com.splitease.notification.domain.Notification;

public interface PushProvider {
    void deliver(String deviceToken, Notification notification);
}
