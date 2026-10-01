package com.splitease.identity.dto;

import java.time.Instant;
import java.util.UUID;

public record AuthResponse(
        String accessToken,
        Instant accessTokenExpiresAt,
        String refreshToken,
        Instant refreshTokenExpiresAt,
        UserView user) {
    public record UserView(UUID id, String email, String displayName) {
    }
}
