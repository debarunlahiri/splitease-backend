package com.splitease.subscription.domain;

import java.math.BigDecimal;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "plans")
public class Plan {
    @Id private UUID id;
    @Column(nullable = false, unique = true, length = 40) private String code;
    @Column(nullable = false, length = 80) private String name;
    @Column(nullable = false, precision = 19, scale = 2) private BigDecimal price;
    @Column(nullable = false, length = 3) private String currency;
    @Column(nullable = false) private int durationDays;
    @Column(nullable = false) private boolean removesAds;
    @Column(nullable = false) private boolean active;
    @Column(unique = true, length = 120) private String googleProductId;
    @Column(unique = true, length = 120) private String appleProductId;

    protected Plan() {
    }

    public UUID getId() { return id; }
    public String getCode() { return code; }
    public String getName() { return name; }
    public BigDecimal getPrice() { return price; }
    public String getCurrency() { return currency; }
    public int getDurationDays() { return durationDays; }
    public boolean isRemovesAds() { return removesAds; }
    public String getGoogleProductId() { return googleProductId; }
    public String getAppleProductId() { return appleProductId; }
}
