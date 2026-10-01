package com.splitease.identity.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public final class AuthRequests {
    private AuthRequests() {
    }

    public record Register(
            @Email @NotBlank String email,
            @NotBlank @Size(min = 2, max = 100) String displayName,
            @NotBlank @Size(min = 8, max = 72) String password) {
    }

    public record Login(@Email @NotBlank String email, @NotBlank String password) {
    }

    public record Refresh(@NotBlank String refreshToken) {
    }

    public record Logout(@NotBlank String refreshToken) {
    }

    public record VerifyEmail(@NotBlank String token) {
    }

    public record ResendVerification(@Email @NotBlank String email) {
    }
}
