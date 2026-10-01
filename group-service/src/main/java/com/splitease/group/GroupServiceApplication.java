package com.splitease.group;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(scanBasePackages = "com.splitease")
public class GroupServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(GroupServiceApplication.class, args);
    }
}
