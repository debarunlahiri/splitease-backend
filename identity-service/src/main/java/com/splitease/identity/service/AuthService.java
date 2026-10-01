package com.splitease.identity.service;

import com.splitease.common.exception.ConflictException;
import com.splitease.identity.domain.User;
import com.splitease.identity.dto.AuthRequests;
import com.splitease.identity.dto.AuthResponse;
import com.splitease.identity.repository.UserRepository;
import com.splitease.identity.security.JwtService;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {
    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final RefreshTokenService refreshTokens;
    private final EmailVerificationService emailVerification;
    private final LoginThrottleService loginThrottle;
    private final String dummyPasswordHash;

    public AuthService(
            UserRepository users,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            RefreshTokenService refreshTokens,
            EmailVerificationService emailVerification,
            LoginThrottleService loginThrottle) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.refreshTokens = refreshTokens;
        this.emailVerification = emailVerification;
        this.loginThrottle = loginThrottle;
        this.dummyPasswordHash = passwordEncoder.encode("timing-check-only-password");
    }

    @Transactional
    public void register(AuthRequests.Register request) {
        if (users.existsByEmailIgnoreCase(request.email())) {
            throw new ConflictException("An account already exists for this email");
        }
        User user = users.save(new User(
                request.email(),
                request.displayName(),
                passwordEncoder.encode(request.password())));
        emailVerification.issue(user);
    }

    @Transactional
    public AuthResponse login(AuthRequests.Login request) {
        String email = request.email().trim().toLowerCase();
        loginThrottle.checkAllowed(email);
        User user = users.findByEmailIgnoreCase(email).orElse(null);
        String passwordHash = user == null ? dummyPasswordHash : user.getPasswordHash();
        if (!passwordEncoder.matches(request.password(), passwordHash) || user == null) {
            loginThrottle.recordFailure(email);
            throw new BadCredentialsException("Invalid email or password");
        }
        loginThrottle.recordSuccess(email);
        if (!user.isEmailVerified()) {
            throw new BadCredentialsException("Email verification is required");
        }
        return response(user);
    }

    @Transactional(noRollbackFor = BadCredentialsException.class)
    public AuthResponse refresh(AuthRequests.Refresh request) {
        RefreshTokenService.Rotation rotation = refreshTokens.rotate(request.refreshToken());
        User user = users.findById(rotation.userId())
                .orElseThrow(() -> new BadCredentialsException("Invalid refresh token"));
        return response(user, rotation.token());
    }

    @Transactional
    public void logout(AuthRequests.Logout request) {
        refreshTokens.revoke(request.refreshToken());
    }

    public void verifyEmail(AuthRequests.VerifyEmail request) {
        emailVerification.verify(request.token());
    }

    public void resendVerification(AuthRequests.ResendVerification request) {
        emailVerification.resend(request.email());
    }

    private AuthResponse response(User user) {
        return response(user, refreshTokens.issue(user.getId()));
    }

    private AuthResponse response(User user, RefreshTokenService.IssuedToken refreshToken) {
        JwtService.Token token = jwtService.issue(user);
        return new AuthResponse(
                token.value(),
                token.expiresAt(),
                refreshToken.value(),
                refreshToken.expiresAt(),
                new AuthResponse.UserView(user.getId(), user.getEmail(), user.getDisplayName()));
    }
}
