CREATE TABLE expense_projections (
    expense_id UUID PRIMARY KEY,
    group_id UUID NOT NULL,
    revision BIGINT NOT NULL,
    snapshot TEXT
);
