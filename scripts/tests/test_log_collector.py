"""Collector tests use temporary files and never connect to Docker/PostgreSQL."""

from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import log_collector as collector


class LogCollectorTests(unittest.TestCase):
    def test_secret_redaction(self):
        line = "Local email verification for user@example.com (Person): secret-value"
        self.assertNotIn("secret-value", collector.sanitize_line(line))
        self.assertNotIn("user@example.com", collector.sanitize_line(line))
        self.assertNotIn("secret-value", collector.sanitize_line("Authorization: Bearer secret-value"))

    def test_sql_quotes_cannot_escape_log_values(self):
        row = collector.record("gateway-service", "file:1", 0, "O'Brien'); DROP TABLE service_logs;--")
        sql = collector.insert_sql([row])
        self.assertIn("O''Brien''); DROP TABLE service_logs;--", sql)
        self.assertIn("ON CONFLICT", sql)
        self.assertIn("COMMIT;", sql)

    def test_api_details_are_structured(self):
        row = collector.record("gateway-service", "file:1", 123,
                               'INFO API_AUDIT {"requestId":"request-1","status":401}')
        self.assertEqual(row["api"]["status"], 401)
        self.assertIn("::jsonb", collector.insert_sql([row]))

    def test_cursor_advances_only_in_returned_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            logs = Path(directory)
            (logs / "gateway-service.log").write_text("first\nsecond\nunfinished")
            original = {}
            with patch.object(collector, "LOGS", logs), patch.object(
                collector, "SERVICES", [("gateway-service", 9890, None)]
            ):
                rows, checkpoint = collector.read_batch(original)
                self.assertEqual([r["text"] for r in rows], ["first", "second"])
                self.assertEqual(original, {})
                retry, _ = collector.read_batch(original)
                self.assertEqual(rows, retry)
                rows, _ = collector.read_batch(checkpoint)
                self.assertEqual(rows, [])

    def test_truncation_generation_is_stable_across_batches(self):
        with tempfile.TemporaryDirectory() as directory:
            logs = Path(directory)
            path = logs / "gateway-service.log"
            path.write_text("old-long-line\n")
            with patch.object(collector, "LOGS", logs), patch.object(
                collector, "SERVICES", [("gateway-service", 9890, None)]
            ):
                _, checkpoint = collector.read_batch({})
                path.write_text("new\n")
                rows, checkpoint = collector.read_batch(checkpoint)
                self.assertEqual(rows[0]["text"], "new")
                self.assertEqual(collector.read_batch(checkpoint)[0], [])


if __name__ == "__main__":
    unittest.main()
