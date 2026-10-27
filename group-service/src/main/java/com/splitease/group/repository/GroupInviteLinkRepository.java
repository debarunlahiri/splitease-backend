package com.splitease.group.repository;

import com.splitease.group.domain.GroupInviteLink;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface GroupInviteLinkRepository extends JpaRepository<GroupInviteLink, UUID> {
    Optional<GroupInviteLink> findByTokenHash(String tokenHash);
}
