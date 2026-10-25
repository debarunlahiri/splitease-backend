package com.splitease.gateway.logging;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Set;

@Component
public class ApiLogSanitizer {
    private final ObjectMapper mapper;
    private static final Set<String> SENSITIVE =
            Set.of(
                    "password",
                    "token",
                    "secret",
                    "credential",
                    "authorization",
                    "cookie",
                    "email",
                    "phone",
                    "address",
                    "name",
                    "notes",
                    "description",
                    "message",
                    "receipt",
                    "photo",
                    "signedpayload");

    public ApiLogSanitizer(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public boolean sensitive(String key) {
        String normalized = key.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        return SENSITIVE.stream().anyMatch(normalized::contains);
    }

    public JsonNode redact(JsonNode node) {
        if (node.isObject()) {
            node.properties()
                    .forEach(
                            entry -> {
                                if (sensitive(entry.getKey())) {
                                    ((com.fasterxml.jackson.databind.node.ObjectNode) node)
                                            .put(entry.getKey(), "[REDACTED]");
                                } else {
                                    redact(entry.getValue());
                                }
                            });
        } else if (node.isArray()) {
            node.forEach(this::redact);
        }
        return node;
    }

    public Object body(String path, HttpHeaders headers, byte[] bytes, boolean truncated) {
        if (path.startsWith("/api/v1/auth/") || path.contains("/webhooks/")) {
            return "[AUTHENTICATION/WEBHOOK BODY OMITTED]";
        }
        if (truncated) {
            return "[BODY EXCEEDS CAPTURE LIMIT]";
        }
        if (bytes.length == 0) {
            return null;
        }
        MediaType type = headers.getContentType();
        if (type == null
                || !(type.getSubtype().equals("json") || type.getSubtype().endsWith("+json"))
                || headers.containsKey(HttpHeaders.CONTENT_ENCODING)) {
            return "[NON-JSON/ENCODED BODY OMITTED]";
        }
        try {
            return redact(mapper.readTree(new String(bytes, StandardCharsets.UTF_8)));
        } catch (Exception ignored) {
            // Never log raw malformed/truncated JSON, which may contain unredacted secrets.
            return "[UNPARSEABLE BODY OMITTED]";
        }
    }
}
