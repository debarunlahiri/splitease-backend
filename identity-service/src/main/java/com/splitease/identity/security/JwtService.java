package com.splitease.identity.security;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;

import javax.crypto.SecretKey;

import com.splitease.identity.domain.User;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class JwtService {
    private final SecretKey secretKey;
    private final Duration lifetime;

    public JwtService(
            @Value("${security.jwt.secret}") String secret,
            @Value("${security.jwt.lifetime:PT1H}") Duration lifetime) {
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.lifetime = lifetime;
    }

    public Token issue(User user) {
        Instant now = Instant.now();
        Instant expiresAt = now.plus(lifetime);
        String value = Jwts.builder()
                .subject(user.getId().toString())
                .claim("email", user.getEmail())
                .claim("email_verified", user.isEmailVerified())
                .issuedAt(Date.from(now))
                .expiration(Date.from(expiresAt))
                .signWith(secretKey)
                .compact();
        return new Token(value, expiresAt);
    }

    public record Token(String value, Instant expiresAt) {
    }
}
