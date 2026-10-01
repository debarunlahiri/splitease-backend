package com.splitease.identity.service;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import com.splitease.identity.domain.RefreshToken;
import com.splitease.identity.repository.RefreshTokenRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RefreshTokenService {
    private final RefreshTokenRepository tokens;
    private final SecureTokenCodec tokenCodec;
    private final Duration lifetime;

    public RefreshTokenService(
            RefreshTokenRepository tokens,
            SecureTokenCodec tokenCodec,
            @Value("${security.refresh-token.lifetime:P30D}") Duration lifetime) {
        this.tokens = tokens;
        this.tokenCodec = tokenCodec;
        this.lifetime = lifetime;
    }

    @Transactional
    public IssuedToken issue(UUID userId) {
        return issue(userId, UUID.randomUUID());
    }

    @Transactional(noRollbackFor = BadCredentialsException.class)
    public Rotation rotate(String rawToken) {
        Instant now = Instant.now();
        RefreshToken current = requireToken(rawToken);
        if (current.getConsumedAt() != null) {
            tokens.revokeFamily(current.getFamilyId(), now);
            throw new BadCredentialsException("Refresh token reuse detected");
        }
        if (current.getRevokedAt() != null || !current.getExpiresAt().isAfter(now)) {
            throw new BadCredentialsException("Refresh token is expired or revoked");
        }
        IssuedToken replacement = issue(current.getUserId(), current.getFamilyId());
        current.consume(now, replacement.id());
        return new Rotation(current.getUserId(), replacement);
    }

    @Transactional
    public void revoke(String rawToken) {
        RefreshToken token = tokens.findByTokenHash(tokenCodec.hash(rawToken)).orElse(null);
        if (token != null) {
            tokens.revokeFamily(token.getFamilyId(), Instant.now());
        }
    }

    private IssuedToken issue(UUID userId, UUID familyId) {
        String rawToken = tokenCodec.generate();
        Instant expiresAt = Instant.now().plus(lifetime);
        RefreshToken saved = tokens.save(new RefreshToken(
                userId, familyId, tokenCodec.hash(rawToken), expiresAt));
        return new IssuedToken(saved.getId(), rawToken, expiresAt);
    }

    private RefreshToken requireToken(String rawToken) {
        return tokens.findByTokenHash(tokenCodec.hash(rawToken))
                .orElseThrow(() -> new BadCredentialsException("Invalid refresh token"));
    }

    public record IssuedToken(UUID id, String value, Instant expiresAt) {
    }

    public record Rotation(UUID userId, IssuedToken token) {
    }
}
