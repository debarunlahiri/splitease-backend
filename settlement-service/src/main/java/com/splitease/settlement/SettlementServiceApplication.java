package com.splitease.settlement;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@EnableScheduling
@SpringBootApplication(scanBasePackages = "com.splitease")
public class SettlementServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(SettlementServiceApplication.class, args);
    }
}
