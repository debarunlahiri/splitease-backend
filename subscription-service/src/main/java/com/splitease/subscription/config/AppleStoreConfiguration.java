package com.splitease.subscription.config;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import com.apple.itunes.storekit.model.Environment;
import com.apple.itunes.storekit.verification.SignedDataVerifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConditionalOnProperty(prefix = "stores.apple", name = "enabled", havingValue = "true")
public class AppleStoreConfiguration {
    @Bean
    SignedDataVerifier appleSignedDataVerifier(
            @Value("${stores.apple.bundle-id}") String bundleId,
            @Value("${stores.apple.app-apple-id:0}") long appAppleId,
            @Value("${stores.apple.environment:PRODUCTION}") String environmentName,
            @Value("${stores.apple.root-certificate-paths}") String certificatePaths) {
        Environment environment = Environment.valueOf(environmentName.toUpperCase(java.util.Locale.ROOT));
        List<Path> paths = Arrays.stream(certificatePaths.split(","))
                .map(String::trim)
                .filter(value -> !value.isBlank())
                .map(Path::of)
                .toList();
        if (paths.isEmpty()) {
            throw new IllegalStateException("Apple root certificates are required when Apple verification is enabled");
        }

        Set<InputStream> certificates = new LinkedHashSet<>();
        try {
            for (Path path : paths) {
                certificates.add(Files.newInputStream(path));
            }
            Long productionAppId = environment == Environment.PRODUCTION ? appAppleId : null;
            return new SignedDataVerifier(certificates, bundleId, productionAppId, environment, true);
        } catch (IOException exception) {
            throw new IllegalStateException("Could not load Apple root certificates", exception);
        } finally {
            certificates.forEach(this::close);
        }
    }

    private void close(InputStream stream) {
        try {
            stream.close();
        } catch (IOException ignored) {
            // The verifier has already consumed the certificate stream.
        }
    }
}

