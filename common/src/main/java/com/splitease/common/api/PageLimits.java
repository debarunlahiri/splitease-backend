package com.splitease.common.api;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

public final class PageLimits {
    private PageLimits() {
    }

    public static PageRequest request(int page, int size, Sort sort) {
        if (page < 0 || size < 1 || size > 100) {
            throw new IllegalArgumentException("Page must be nonnegative and size must be between 1 and 100");
        }
        return PageRequest.of(page, size, sort);
    }
}
