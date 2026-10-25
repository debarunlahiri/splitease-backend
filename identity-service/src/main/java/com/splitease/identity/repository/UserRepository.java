package com.splitease.identity.repository;

import java.util.Optional;
import java.util.UUID;

import com.splitease.identity.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, UUID> {
    Optional<User> findByEmailIgnoreCase(String email);
    Optional<User> findByFirebaseUid(String firebaseUid);
    boolean existsByEmailIgnoreCase(String email);
}
