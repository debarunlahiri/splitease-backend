package com.splitease.settlement.repository;

import java.util.List;
import java.util.UUID;

import com.splitease.settlement.domain.GroupBalance;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface GroupBalanceRepository extends JpaRepository<GroupBalance, UUID> {
    List<GroupBalance> findByGroupIdAndCurrencyOrderByUserId(UUID groupId, String currency);

    @Modifying
    @Query(value = """
            INSERT INTO group_balances (id, group_id, user_id, currency, amount, updated_at)
            VALUES (:id, :groupId, :userId, :currency, :delta, CURRENT_TIMESTAMP)
            ON CONFLICT (group_id, user_id, currency)
            DO UPDATE SET
                amount = group_balances.amount + EXCLUDED.amount,
                updated_at = CURRENT_TIMESTAMP
            """, nativeQuery = true)
    void adjust(
            @Param("id") UUID id,
            @Param("groupId") UUID groupId,
            @Param("userId") UUID userId,
            @Param("currency") String currency,
            @Param("delta") java.math.BigDecimal delta);
}
