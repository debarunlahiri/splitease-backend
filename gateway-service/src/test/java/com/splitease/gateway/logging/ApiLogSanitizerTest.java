package com.splitease.gateway.logging;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;

import java.nio.charset.StandardCharsets;

class ApiLogSanitizerTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private final ApiLogSanitizer sanitizer = new ApiLogSanitizer(mapper);

    @Test
    void nestedSecretsAndPersonalDataAreRedacted() throws Exception {
        var sanitized =
                sanitizer.redact(
                        mapper.readTree(
                                "{\"amount\":25,\"nested\":[{\"idToken\":\"secret\",\"email\":\"a@b.test\"}]}"));
        assertEquals(25, sanitized.get("amount").asInt());
        assertFalse(sanitized.toString().contains("secret"));
        assertFalse(sanitized.toString().contains("a@b.test"));
    }

    @Test
    void authenticationBodiesAreNeverCaptured() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        Object result =
                sanitizer.body(
                        "/api/v1/auth/login",
                        headers,
                        "{\"password\":\"secret\"}".getBytes(StandardCharsets.UTF_8),
                        false);
        assertEquals("[AUTHENTICATION/WEBHOOK BODY OMITTED]", result);
    }

    @Test
    void truncationAndMalformedJsonNeverFallBackToRawText() {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        byte[] bytes = "{\"password\":\"secret".getBytes(StandardCharsets.UTF_8);
        assertEquals(
                "[BODY EXCEEDS CAPTURE LIMIT]",
                sanitizer.body("/api/v1/groups", headers, bytes, true));
        assertEquals(
                "[UNPARSEABLE BODY OMITTED]",
                sanitizer.body("/api/v1/groups", headers, bytes, false));
    }
}
