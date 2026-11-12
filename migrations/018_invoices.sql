-- Invoices are stored records with their own number, so they can be listed and searched.
CREATE SEQUENCE invoice_seq START 1;

CREATE TABLE invoices (
    id UUID PRIMARY KEY,
    number VARCHAR(24) NOT NULL UNIQUE,
    payee_id UUID NOT NULL,          -- who was paid (and issues the invoice)
    payer_id UUID NOT NULL,          -- who paid (billed to)
    group_id UUID NOT NULL,
    expense_key UUID NOT NULL,       -- the expense for a single-expense invoice, else the group's id
    link_code VARCHAR(16),
    link_index INT,
    currency VARCHAR(3) NOT NULL,
    total NUMERIC(19, 2) NOT NULL,
    paid NUMERIC(19, 2) NOT NULL,
    status VARCHAR(10) NOT NULL CHECK (status IN ('PAID', 'PARTIAL')),
    items JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    paid_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    UNIQUE (payee_id, payer_id, group_id, expense_key)
);
CREATE INDEX idx_invoices_payee ON invoices(payee_id, paid_at DESC);
CREATE INDEX idx_invoices_payer ON invoices(payer_id, paid_at DESC);
