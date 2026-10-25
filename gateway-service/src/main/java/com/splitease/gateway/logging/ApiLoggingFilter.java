package com.splitease.gateway.logging;

import com.fasterxml.jackson.databind.ObjectMapper;

import org.reactivestreams.Publisher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cloud.gateway.route.Route;
import org.springframework.cloud.gateway.support.ServerWebExchangeUtils;
import org.springframework.core.Ordered;
import org.springframework.core.io.buffer.DataBuffer;
import org.springframework.http.server.reactive.ServerHttpRequestDecorator;
import org.springframework.http.server.reactive.ServerHttpResponseDecorator;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilter;
import org.springframework.web.server.WebFilterChain;

import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.SignalType;

import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

@Component
public class ApiLoggingFilter implements WebFilter, Ordered {
    private static final Logger LOG = LoggerFactory.getLogger(ApiLoggingFilter.class);
    private static final Set<String> SAFE_QUERY = Set.of("page", "size", "currency");
    private final ObjectMapper mapper;
    private final ApiLogSanitizer sanitizer;
    private final int captureLimit;

    public ApiLoggingFilter(
            ObjectMapper mapper,
            ApiLogSanitizer sanitizer,
            @Value("${api.logging.body-limit:16384}") int captureLimit) {
        this.mapper = mapper;
        this.sanitizer = sanitizer;
        this.captureLimit = Math.max(0, Math.min(captureLimit, 65536));
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        String path = exchange.getRequest().getPath().value();
        if (!path.startsWith("/api/")) {
            return chain.filter(exchange);
        }
        String requestId = UUID.randomUUID().toString();
        Instant startedAt = Instant.now();
        long started = System.nanoTime();
        Capture requestBody = new Capture(captureLimit);
        Capture responseBody = new Capture(captureLimit);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        var identified =
                exchange.getRequest()
                        .mutate()
                        .headers(headers -> headers.set("X-Request-Id", requestId))
                        .build();
        var request =
                new ServerHttpRequestDecorator(identified) {
                    @Override
                    public Flux<DataBuffer> getBody() {
                        return super.getBody().doOnNext(requestBody::copy);
                    }
                };
        exchange.getResponse().getHeaders().set("X-Request-Id", requestId);
        var response =
                new ServerHttpResponseDecorator(exchange.getResponse()) {
                    @Override
                    public Mono<Void> writeWith(Publisher<? extends DataBuffer> body) {
                        return super.writeWith(Flux.from(body).doOnNext(responseBody::copy));
                    }

                    @Override
                    public Mono<Void> writeAndFlushWith(
                            Publisher<? extends Publisher<? extends DataBuffer>> body) {
                        return super.writeAndFlushWith(
                                Flux.from(body)
                                        .map(part -> Flux.from(part).doOnNext(responseBody::copy)));
                    }
                };
        ServerWebExchange decorated = exchange.mutate().request(request).response(response).build();
        return chain.filter(decorated)
                .doOnError(failure::set)
                .doFinally(
                        signal -> {
                            try {
                                Map<String, Object> entry = new LinkedHashMap<>();
                                entry.put("requestId", requestId);
                                entry.put("startedAt", startedAt.toString());
                                entry.put("completedAt", Instant.now().toString());
                                entry.put("method", request.getMethod().name());
                                entry.put("path", path);
                                Map<String, Object> query = new LinkedHashMap<>();
                                request.getQueryParams()
                                        .forEach(
                                                (key, values) ->
                                                        query.put(
                                                                key,
                                                                SAFE_QUERY.contains(key)
                                                                        ? values
                                                                        : "[REDACTED]"));
                                entry.put("query", query);
                                entry.put(
                                        "clientAddress",
                                        request.getRemoteAddress() == null
                                                ? null
                                                : request.getRemoteAddress()
                                                        .getAddress()
                                                        .getHostAddress());
                                entry.put("userId", decorated.getAttribute("audit.userId"));
                                Route route =
                                        decorated.getAttribute(
                                                ServerWebExchangeUtils.GATEWAY_ROUTE_ATTR);
                                entry.put("route", route == null ? null : route.getId());
                                int status =
                                        response.getStatusCode() == null
                                                ? 200
                                                : response.getStatusCode().value();
                                if (signal == SignalType.CANCEL) {
                                    status = 499;
                                } else if (failure.get() != null && !response.isCommitted()) {
                                    status =
                                            failure.get() instanceof ResponseStatusException error
                                                    ? error.getStatusCode().value()
                                                    : 500;
                                }
                                entry.put("status", status);
                                entry.put(
                                        "durationMs", (System.nanoTime() - started) / 1_000_000.0);
                                entry.put("outcome", signal.name());
                                entry.put(
                                        "errorType",
                                        failure.get() == null
                                                ? null
                                                : failure.get().getClass().getName());
                                entry.put(
                                        "requestContentType",
                                        request.getHeaders().getFirst("Content-Type"));
                                entry.put(
                                        "responseContentType",
                                        response.getHeaders().getFirst("Content-Type"));
                                entry.put("requestBytesObserved", requestBody.observed);
                                entry.put("responseBytesObserved", responseBody.observed);
                                entry.put("requestBodyTruncated", requestBody.truncated());
                                entry.put("responseBodyTruncated", responseBody.truncated());
                                entry.put(
                                        "requestBody",
                                        sanitizer.body(
                                                path,
                                                request.getHeaders(),
                                                requestBody.bytes(),
                                                requestBody.truncated()));
                                entry.put(
                                        "responseBody",
                                        sanitizer.body(
                                                path,
                                                response.getHeaders(),
                                                responseBody.bytes(),
                                                responseBody.truncated()));
                                LOG.info("API_AUDIT {}", mapper.writeValueAsString(entry));
                            } catch (Exception loggingFailure) {
                                LOG.error(
                                        "API audit serialization failed; requestId={} errorType={}",
                                        requestId,
                                        loggingFailure.getClass().getName());
                            }
                        });
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }

    private static final class Capture {
        private final int limit;
        private final ByteArrayOutputStream output = new ByteArrayOutputStream();
        private long observed;

        Capture(int limit) {
            this.limit = limit;
        }

        synchronized void copy(DataBuffer buffer) {
            observed += buffer.readableByteCount();
            int length = Math.min(limit - output.size(), buffer.readableByteCount());
            if (length > 0) {
                byte[] bytes = new byte[length];
                buffer.asByteBuffer(buffer.readPosition(), length).get(bytes);
                output.writeBytes(bytes);
            }
        }

        synchronized byte[] bytes() {
            return output.toByteArray();
        }

        synchronized boolean truncated() {
            return observed > limit;
        }
    }
}
