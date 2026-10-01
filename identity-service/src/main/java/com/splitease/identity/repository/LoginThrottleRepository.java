package com.splitease.identity.repository;

import com.splitease.identity.domain.LoginThrottle;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LoginThrottleRepository extends JpaRepository<LoginThrottle, String> {
}
