package com.splitease.identity.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(
        prefix = "security.email-verification.logging-sender",
        name = "enabled",
        havingValue = "true")
public class LoggingEmailVerificationSender implements EmailVerificationSender {
    private static final Logger LOGGER = LoggerFactory.getLogger(LoggingEmailVerificationSender.class);

    @Override
    public void sendVerification(String email, String displayName, String verificationToken) {
        LOGGER.info("Local email verification for {} ({}): {}", email, displayName, verificationToken);
    }
}
