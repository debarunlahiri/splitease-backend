package com.splitease.gateway.filter;

import java.nio.charset.StandardCharsets;
import java.util.List;

import javax.crypto.SecretKey;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

@Component
public class AuthenticationFilter implements GlobalFilter, Ordered {

    private static final List<String> PUBLIC_PATHS = List.of(
            "/api/v1/auth/",
            "/api/v1/subscriptions/plans",
            "/api/v1/subscriptions/webhooks/",
            "/actuator/");

    private final SecretKey secretKey;

    public AuthenticationFilter(@Value("${security.jwt.secret}") String secret) {
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getURI().getPath();
        if (PUBLIC_PATHS.stream().anyMatch(path::startsWith)) {
            return chain.filter(exchange);
        }

        String authorization = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return reject(exchange);
        }

        try {
            Claims claims = Jwts.parser()
                    .verifyWith(secretKey)
                    .build()
                    .parseSignedClaims(authorization.substring(7))
                    .getPayload();
            ServerWebExchange authenticatedExchange = exchange.mutate()
                    .request(request -> request.headers(headers -> {
                        headers.remove("X-User-Id");
                        headers.remove("X-User-Email");
                        headers.add("X-User-Id", claims.getSubject());
                        headers.add("X-User-Email", claims.get("email", String.class));
                    }))
                    .build();
            return chain.filter(authenticatedExchange);
        } catch (RuntimeException invalidToken) {
            return reject(exchange);
        }
    }

    private Mono<Void> reject(ServerWebExchange exchange) {
        exchange.getResponse().setStatusCode(HttpStatus.UNAUTHORIZED);
        return exchange.getResponse().setComplete();
    }

    @Override
    public int getOrder() {
        return -100;
    }
}
