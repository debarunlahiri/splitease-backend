package com.splitease.expense;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@EnableScheduling
@SpringBootApplication(scanBasePackages = "com.splitease")
public class ExpenseServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(ExpenseServiceApplication.class, args);
    }
}
