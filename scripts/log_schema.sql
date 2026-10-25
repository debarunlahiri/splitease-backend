CREATE TABLE IF NOT EXISTS service_logs (
    id BIGSERIAL PRIMARY KEY,
    service_name VARCHAR(80) NOT NULL,
    file_identity TEXT NOT NULL,
    byte_offset BIGINT NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    log_text TEXT NOT NULL,
    api_details JSONB,
    UNIQUE (service_name, file_identity, byte_offset)
);
CREATE INDEX IF NOT EXISTS idx_service_logs_recorded_at ON service_logs(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_logs_service_time ON service_logs(service_name, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_logs_request_id ON service_logs((api_details ->> 'requestId'))
    WHERE api_details IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_logs_status ON service_logs((api_details ->> 'status'))
    WHERE api_details IS NOT NULL;

CREATE OR REPLACE VIEW api_request_logs AS
SELECT id, recorded_at, service_name,
       api_details ->> 'requestId' AS request_id,
       api_details ->> 'method' AS method,
       api_details ->> 'path' AS path,
       api_details ->> 'status' AS status,
       api_details ->> 'durationMs' AS duration_ms,
       api_details
FROM service_logs
WHERE api_details IS NOT NULL;
