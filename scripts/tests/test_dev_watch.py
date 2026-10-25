"""Watch planning tests; no services or builds are executed."""

from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dev_watch import affected_services, snapshot

SERVICES = [(name + "-service", 0, None) for name in
            ["discovery", "gateway", "identity", "group", "expense", "settlement", "subscription", "notification"]]


class DevWatchTests(unittest.TestCase):
    def test_service_change_targets_just_that_service(self):
        self.assertEqual(affected_services({"expense-service/src/main/Thing.java"}, SERVICES), {"expense-service"})

    def test_common_change_targets_dependent_services(self):
        selected = affected_services({"common/src/main/Thing.java"}, SERVICES)
        self.assertEqual(len(selected), 6)
        self.assertNotIn("gateway-service", selected)
        self.assertNotIn("discovery-service", selected)

    def test_parent_is_shared_but_registry_restart_is_local(self):
        self.assertEqual(len(affected_services({"pom.xml"}, SERVICES)), 8)
        self.assertEqual(affected_services({"discovery-service/src/main/application.yml"}, SERVICES), {"discovery-service"})

    def test_firebase_environment_change_only_restarts_identity(self):
        self.assertEqual(affected_services({".env"}, SERVICES, {"FIREBASE_PROJECT_ID"}), {"identity-service"})

    def test_credentials_affect_only_services_using_google_admin(self):
        self.assertEqual(affected_services({".env"}, SERVICES, {"GOOGLE_APPLICATION_CREDENTIALS"}),
                         {"identity-service", "subscription-service"})

    def test_no_effective_env_change_does_not_restart(self):
        self.assertEqual(affected_services({".env"}, SERVICES, set()), set())
        self.assertEqual(affected_services({".env.example"}, SERVICES), set())

    def test_config_references_map_to_their_service(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "group-service/src/main/resources/application.yml"
            config.parent.mkdir(parents=True)
            config.write_text("groups.invitation-lifetime: ${GROUP_INVITATION_LIFETIME:P7D}")
            self.assertEqual(affected_services({".env"}, SERVICES, {"GROUP_INVITATION_LIFETIME"}, root), {"group-service"})

    def test_snapshot_ignores_generated_files_and_detects_deletions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "expense-service/src/main/A.java"
            source.parent.mkdir(parents=True)
            source.write_text("source")
            generated = root / "expense-service/target/generated.txt"
            generated.parent.mkdir()
            generated.write_text("output")
            before = snapshot(root, SERVICES)
            self.assertIn(str(source.relative_to(root)), before)
            self.assertNotIn(str(generated.relative_to(root)), before)
            source.unlink()
            self.assertNotIn(str(source.relative_to(root)), snapshot(root, SERVICES))


if __name__ == "__main__":
    unittest.main()
