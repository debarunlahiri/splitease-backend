package com.splitease.identity.service;

public interface EmailVerificationSender {
    void sendVerification(String email, String displayName, String verificationToken);
}
