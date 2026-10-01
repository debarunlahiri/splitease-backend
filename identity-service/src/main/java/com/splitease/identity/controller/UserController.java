package com.splitease.identity.controller;

import java.util.UUID;

import com.splitease.common.exception.NotFoundException;
import com.splitease.identity.dto.AuthResponse.UserView;
import com.splitease.identity.repository.UserRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/users")
public class UserController {
    private final UserRepository users;

    public UserController(UserRepository users) {
        this.users = users;
    }

    @GetMapping("/me")
    public UserView me(@RequestHeader("X-User-Id") UUID userId) {
        return users.findById(userId)
                .map(user -> new UserView(user.getId(), user.getEmail(), user.getDisplayName()))
                .orElseThrow(() -> new NotFoundException("User not found"));
    }
}

