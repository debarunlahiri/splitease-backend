package com.splitease.identity.controller;

import com.splitease.identity.repository.UserRepository;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/internal/v1/users")
public class InternalUserController {
    private final UserRepository users;
    private final byte[] serviceKey;

    public InternalUserController(
            UserRepository users,
            @Value("${INTERNAL_SERVICE_KEY:replace-with-an-internal-service-key}") String key) {
        this.users = users;
        this.serviceKey = key.getBytes(StandardCharsets.UTF_8);
    }

    @PostMapping("/profiles")
    public List<MemberProfile> profiles(
            @RequestHeader(value = "X-Service-Key", required = false) String supplied,
            @Valid @RequestBody ProfileRequest request) {
        if (!MessageDigest.isEqual(
                serviceKey,
                supplied == null ? new byte[0] : supplied.getBytes(StandardCharsets.UTF_8))) {
            throw new AccessDeniedException("Invalid internal service credentials");
        }
        return users.findAllById(request.userIds()).stream()
                .map(user -> new MemberProfile(user.getId(), user.getDisplayName()))
                .toList();
    }

    @PostMapping("/by-email")
    public MemberProfile byEmail(
            @RequestHeader(value = "X-Service-Key", required = false) String supplied,
            @Valid @RequestBody EmailRequest request) {
        if (!MessageDigest.isEqual(
                serviceKey,
                supplied == null ? new byte[0] : supplied.getBytes(StandardCharsets.UTF_8))) {
            throw new AccessDeniedException("Invalid internal service credentials");
        }
        return users.findByEmailIgnoreCase(request.email().trim())
                .map(user -> new MemberProfile(user.getId(), user.getDisplayName()))
                .orElseThrow(
                        () ->
                                new com.splitease.common.exception.NotFoundException(
                                        "Recipient not registered"));
    }

    public record EmailRequest(
            @jakarta.validation.constraints.NotBlank @jakarta.validation.constraints.Email
                    String email) {}

    public record ProfileRequest(@NotNull @Size(max = 200) List<@NotNull UUID> userIds) {}

    public record MemberProfile(UUID userId, String displayName) {}
}
