package com.splitease.identity.repository;

import java.util.Optional;
import java.util.UUID;

import com.splitease.identity.domain.EmailVerificationToken;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;

public interface EmailVerificationTokenRepository extends JpaRepository<EmailVerificationToken, UUID> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    Optional<EmailVerificationToken> findByTokenHash(String tokenHash);

    void deleteByUserId(UUID userId);
}
