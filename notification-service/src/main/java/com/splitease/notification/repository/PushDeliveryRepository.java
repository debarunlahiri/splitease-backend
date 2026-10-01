package com.splitease.notification.repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.splitease.notification.domain.PushDelivery;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PushDeliveryRepository extends JpaRepository<PushDelivery, UUID> {
    @Query(value = """
            SELECT * FROM push_deliveries
            WHERE delivered_at IS NULL AND attempts < 10 AND next_attempt_at <= :now
            ORDER BY next_attempt_at ASC
            LIMIT :limit FOR UPDATE SKIP LOCKED
            """, nativeQuery = true)
    List<PushDelivery> claimPending(@Param("now") Instant now, @Param("limit") int limit);
}
