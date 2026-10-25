package com.splitease.common.idempotency;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.splitease.common.exception.ConflictException;

import jakarta.servlet.http.HttpServletRequest;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.TreeMap;
import java.util.UUID;

/** Saves the successful result in the same database transaction as the business write. */
@Aspect
@Component
public class IdempotencyAspect {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final TransactionTemplate transaction;

    public IdempotencyAspect(
            JdbcTemplate jdbc, ObjectMapper mapper, PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Around("@annotation(com.splitease.common.idempotency.IdempotentRequest)")
    public Object protect(ProceedingJoinPoint invocation) throws Throwable {
        ServletRequestAttributes attributes =
                (ServletRequestAttributes) RequestContextHolder.currentRequestAttributes();
        HttpServletRequest request = attributes.getRequest();
        String key = request.getHeader("Idempotency-Key");
        if (key == null || !key.matches("[A-Za-z0-9][A-Za-z0-9._:-]{7,127}")) {
            throw new IllegalArgumentException(
                    "Idempotency-Key is required and must contain 8-128 letters, digits, dots,"
                            + " colons, underscores or hyphens");
        }
        UUID userId = UUID.fromString(request.getHeader("X-User-Id"));
        Method method = ((MethodSignature) invocation.getSignature()).getMethod();
        String fingerprint =
                hash(
                        request.getMethod()
                                + "\n"
                                + request.getRequestURI()
                                + "\n"
                                + String.valueOf(request.getQueryString())
                                + "\n"
                                + mapper.writeValueAsString(
                                        canonical(mapper.valueToTree(invocation.getArgs()))));
        try {
            return transaction.execute(
                    status -> {
                        // Bound waiting when another instance is still processing the same request.
                        jdbc.execute("SET LOCAL lock_timeout = '5s'");
                        int inserted =
                                jdbc.update(
                                        """
                                        INSERT INTO api_idempotency (user_id, key_hash, fingerprint)
                                        VALUES (?, ?, ?) ON CONFLICT (user_id, key_hash) DO NOTHING
                                        """,
                                        userId,
                                        hash(key),
                                        fingerprint);
                        if (inserted == 0) {
                            Stored stored =
                                    jdbc.queryForObject(
                                            """
                                            SELECT fingerprint, response_json FROM api_idempotency
                                            WHERE user_id = ? AND key_hash = ? FOR UPDATE
                                            """,
                                            (row, index) ->
                                                    new Stored(row.getString(1), row.getString(2)),
                                            userId,
                                            hash(key));
                            if (stored == null || !stored.fingerprint().equals(fingerprint)) {
                                throw new ConflictException(
                                        "Idempotency-Key was already used for a different request");
                            }
                            if (stored.responseJson() == null) {
                                throw new ConflictException(
                                        "Request is still processing; retry with the same"
                                                + " Idempotency-Key");
                            }
                            if (attributes.getResponse() != null) {
                                attributes.getResponse().setHeader("Idempotency-Replayed", "true");
                            }
                            try {
                                return method.getReturnType() == void.class
                                        ? null
                                        : mapper.readValue(
                                                stored.responseJson(),
                                                mapper.constructType(
                                                        method.getGenericReturnType()));
                            } catch (java.io.IOException exception) {
                                throw new IllegalStateException(
                                        "Stored request result could not be read", exception);
                            }
                        }
                        try {
                            Object result = invocation.proceed();
                            jdbc.update(
                                    """
                                    UPDATE api_idempotency SET response_json = ?, completed_at = CURRENT_TIMESTAMP
                                    WHERE user_id = ? AND key_hash = ?
                                    """,
                                    mapper.writeValueAsString(result),
                                    userId,
                                    hash(key));
                            return result;
                        } catch (Throwable failure) {
                            // Wrapping forces rollback even for checked exceptions; unwrap outside
                            // the transaction.
                            throw new InvocationFailure(failure);
                        }
                    });
        } catch (InvocationFailure failure) {
            throw failure.getCause();
        } catch (PessimisticLockingFailureException | QueryTimeoutException busy) {
            throw new ConflictException(
                    "Request is still processing; retry with the same Idempotency-Key");
        }
    }

    static JsonNode canonical(JsonNode node) {
        if (node.isObject()) {
            TreeMap<String, JsonNode> fields = new TreeMap<>();
            node.fields()
                    .forEachRemaining(
                            entry -> fields.put(entry.getKey(), canonical(entry.getValue())));
            ObjectNode sorted = ((ObjectNode) node).objectNode();
            fields.forEach(sorted::set);
            return sorted;
        }
        if (node.isArray()) {
            ArrayNode values = ((ArrayNode) node).arrayNode();
            node.forEach(value -> values.add(canonical(value)));
            return values;
        }
        return node;
    }

    private static String hash(String value) {
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private record Stored(String fingerprint, String responseJson) {}

    private static final class InvocationFailure extends RuntimeException {
        InvocationFailure(Throwable cause) {
            super(cause);
        }
    }
}
