package com.splitease.common.idempotency;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.splitease.common.exception.ConflictException;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.reflect.MethodSignature;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.sql.ResultSet;
import java.util.UUID;

class IdempotencyAspectTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final PlatformTransactionManager manager = mock(PlatformTransactionManager.class);
    private final ProceedingJoinPoint invocation = mock(ProceedingJoinPoint.class);
    private final ObjectMapper mapper = new ObjectMapper();
    private final UUID userId = UUID.randomUUID();
    private IdempotencyAspect aspect;
    private MockHttpServletRequest request;

    @BeforeEach
    void prepare() throws Exception {
        when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        aspect = new IdempotencyAspect(jdbc, mapper, manager);
        request = new MockHttpServletRequest("POST", "/api/v1/groups");
        request.addHeader("X-User-Id", userId.toString());
        request.addHeader("Idempotency-Key", UUID.randomUUID().toString());
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        MethodSignature signature = mock(MethodSignature.class);
        when(signature.getMethod())
                .thenReturn(ExampleController.class.getMethod("create", UUID.class, String.class));
        when(invocation.getSignature()).thenReturn(signature);
        when(invocation.getArgs()).thenReturn(new Object[] {userId, "Holiday"});
    }

    @AfterEach
    void clearRequest() {
        RequestContextHolder.resetRequestAttributes();
    }

    @Test
    void missingKeyNeverExecutesBusinessWrite() {
        request.removeHeader("Idempotency-Key");
        assertThrows(IllegalArgumentException.class, () -> aspect.protect(invocation));
        verifyNoInteractions(jdbc, manager);
    }

    @Test
    void successStoresResponseAndCommits() throws Throwable {
        when(jdbc.update(contains("INSERT INTO"), eq(userId), anyString(), anyString()))
                .thenReturn(1);
        when(invocation.proceed()).thenReturn(new ExampleResponse("group-1"));
        assertEquals(new ExampleResponse("group-1"), aspect.protect(invocation));
        verify(jdbc)
                .update(
                        contains("UPDATE api_idempotency"),
                        eq("{\"id\":\"group-1\"}"),
                        eq(userId),
                        anyString());
        verify(manager).commit(any());
        verify(manager, never()).rollback(any());
    }

    @Test
    void businessFailureRollsBackReservationAndResponse() throws Throwable {
        when(jdbc.update(contains("INSERT INTO"), eq(userId), anyString(), anyString()))
                .thenReturn(1);
        IllegalStateException failure = new IllegalStateException("write failed");
        when(invocation.proceed()).thenThrow(failure);
        assertSame(
                failure,
                assertThrows(IllegalStateException.class, () -> aspect.protect(invocation)));
        verify(manager).rollback(any());
        verify(manager, never()).commit(any());
        verify(jdbc, never()).update(contains("UPDATE api_idempotency"), any(), any(), any());
    }

    @Test
    void duplicateReplaysWithoutExecutingAgain() throws Throwable {
        stubReplay(false);
        assertEquals(new ExampleResponse("original-group"), aspect.protect(invocation));
        verify(invocation, never()).proceed();
    }

    @Test
    void reusedKeyWithDifferentPayloadConflicts() throws Throwable {
        stubReplay(true);
        assertThrows(ConflictException.class, () -> aspect.protect(invocation));
        verify(invocation, never()).proceed();
    }

    @Test
    void canonicalObjectOrderDoesNotChangeFingerprintInput() throws Exception {
        assertEquals(
                IdempotencyAspect.canonical(mapper.readTree("{\"b\":2,\"a\":1}")),
                IdempotencyAspect.canonical(mapper.readTree("{\"a\":1,\"b\":2}")));
    }

    private void stubReplay(boolean differentFingerprint) throws Exception {
        String[] fingerprint = new String[1];
        when(jdbc.update(contains("INSERT INTO"), eq(userId), anyString(), anyString()))
                .thenAnswer(
                        call -> {
                            fingerprint[0] = call.getArgument(3);
                            return 0;
                        });
        when(jdbc.queryForObject(
                        contains("SELECT fingerprint"),
                        any(RowMapper.class),
                        eq(userId),
                        anyString()))
                .thenAnswer(
                        call -> {
                            ResultSet row = mock(ResultSet.class);
                            when(row.getString(1))
                                    .thenReturn(
                                            differentFingerprint ? "different" : fingerprint[0]);
                            when(row.getString(2)).thenReturn("{\"id\":\"original-group\"}");
                            RowMapper<?> rowMapper = call.getArgument(1);
                            return rowMapper.mapRow(row, 0);
                        });
    }

    public record ExampleResponse(String id) {}

    public static class ExampleController {
        public ExampleResponse create(UUID userId, String name) {
            throw new UnsupportedOperationException();
        }
    }
}
