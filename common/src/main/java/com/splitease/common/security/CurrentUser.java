package com.splitease.common.security;

import java.util.UUID;

public final class CurrentUser {

    public static final String USER_ID_HEADER = "X-User-Id";
    public static final String USER_EMAIL_HEADER = "X-User-Email";

    private CurrentUser() {
    }

    public static UUID requireUserId(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Authenticated user id is required");
        }
        return UUID.fromString(value);
    }
}

