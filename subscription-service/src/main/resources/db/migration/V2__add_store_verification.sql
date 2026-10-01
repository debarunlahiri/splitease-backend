ALTER TABLE plans
    ADD COLUMN google_product_id VARCHAR(120),
    ADD COLUMN apple_product_id VARCHAR(120);

CREATE UNIQUE INDEX uq_plans_google_product_id
    ON plans(google_product_id)
    WHERE google_product_id IS NOT NULL;

CREATE UNIQUE INDEX uq_plans_apple_product_id
    ON plans(apple_product_id)
    WHERE apple_product_id IS NOT NULL;

UPDATE plans
SET
    google_product_id = CASE code
        WHEN 'NO_ADS_MONTHLY' THEN 'splitease_no_ads_monthly'
        WHEN 'NO_ADS_YEARLY' THEN 'splitease_no_ads_yearly'
    END,
    apple_product_id = CASE code
        WHEN 'NO_ADS_MONTHLY' THEN 'splitease.no_ads.monthly'
        WHEN 'NO_ADS_YEARLY' THEN 'splitease.no_ads.yearly'
    END;

ALTER TABLE subscriptions
    ADD COLUMN provider VARCHAR(30) NOT NULL DEFAULT 'LEGACY';

ALTER TABLE subscriptions
    ALTER COLUMN provider DROP DEFAULT;
