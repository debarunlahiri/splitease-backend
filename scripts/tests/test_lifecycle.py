"""Isolated lifecycle checks; never starts Java, Docker, Maven, or databases."""

import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "lifecycle", Path(__file__).resolve().parents[1] / "lifecycle.py"
)
lifecycle = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(lifecycle)


class LifecycleTests(unittest.TestCase):
    def test_process_ownership_requires_this_checkout(self):
        root = lifecycle.ROOT
        self.assertTrue(lifecycle.belongs_to_project(
            f"/usr/bin/java {lifecycle.MARKER} -jar {root}/identity-service/target/identity-service-1.jar"
        ))
        self.assertTrue(lifecycle.belongs_to_project(
            f"java -jar {root}/identity-service/target/identity-service-1.jar"
        ))
        self.assertTrue(lifecycle.belongs_to_project(
            f"java -cp {root}/identity-service/target/classes com.splitease.identity.IdentityServiceApplication"
        ))
        self.assertTrue(lifecycle.belongs_to_project(
            f"/Applications/Java Runtime/bin/java {lifecycle.MARKER} -jar {root}/identity-service/target/identity-service-1.jar"
        ))
        self.assertFalse(lifecycle.belongs_to_project("java -jar /other/identity-service-1.jar"))
        self.assertFalse(lifecycle.belongs_to_project("java -Dserver.port=9891 unrelated.Main"))
        self.assertFalse(lifecycle.belongs_to_project(f"echo {lifecycle.MARKER}"))

    def test_environment_is_data_and_shell_overrides_win(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text('POSTGRES_USER=file_user\nTEST_LITERAL="$(touch /never-run)"\n')
            with patch.object(lifecycle, "ROOT", root), patch.dict(
                lifecycle.os.environ, {"POSTGRES_USER": "shell_user"}, clear=True
            ):
                env = lifecycle.load_environment()
            self.assertEqual(env["POSTGRES_USER"], "shell_user")
            self.assertEqual(env["TEST_LITERAL"], "$(touch /never-run)")

    def test_missing_databases_use_conditional_creation(self):
        calls = []

        def fake_run(arguments, **kwargs):
            calls.append((arguments, kwargs))
            return subprocess.CompletedProcess(arguments, 0, "")

        env = {"POSTGRES_USER": "splitease", "POSTGRES_PASSWORD": "test"}
        with patch.object(lifecycle, "run", side_effect=fake_run), patch.object(
            lifecycle, "wait_until"
        ):
            lifecycle.prepare_infrastructure(env)
        sql = next(kwargs["input_text"] for _, kwargs in calls if "input_text" in kwargs)
        self.assertEqual(sql.count("WHERE NOT EXISTS"), 7)
        self.assertEqual(sql.count("\\gexec"), 7)
        self.assertNotIn("DROP", sql)
        self.assertNotIn("TRUNCATE", sql)
        tcp_checks = [args for args, _ in calls if "splitease_identity" in args]
        self.assertEqual(len(tcp_checks), 1)

    def test_failed_service_does_not_report_ready(self):
        class Exited:
            def poll(self):
                return 1
        with self.assertRaises(lifecycle.LifecycleError):
            lifecycle.service_ready(Exited(), 9891, "identity-service")

    def test_configuration_rejects_shared_database_override(self):
        env = {"JWT_SECRET": "a" * 48, "INTERNAL_SERVICE_KEY": "b" * 48,
               "POSTGRES_USER": "splitease", "POSTGRES_PASSWORD": "unique-password",
               "DATABASE_URL": "jdbc:postgresql://external/other"}
        with self.assertRaises(lifecycle.LifecycleError):
            lifecycle.validate_configuration(env)


class RuntimeSelectionTests(unittest.TestCase):
    def test_java_version_detection(self):
        self.assertEqual(lifecycle.java_major('openjdk version "17.0.20.1"'), 17)
        self.assertEqual(lifecycle.java_major('openjdk version "26.0.1"'), 26)
        self.assertEqual(lifecycle.java_major('java version "21.0.8"'), 21)
        self.assertEqual(lifecycle.java_major('openjdk 25.0.1 2025-10-21'), 25)
        self.assertEqual(lifecycle.java_major('java version "1.8.0_402"'), 8)

    def test_selects_installed_supported_jdk_and_pins_path(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            old = home / "old/bin/java"
            new = home / "new/Contents/Home/bin/java"
            old.parent.mkdir(parents=True)
            new.parent.mkdir(parents=True)
            old.touch()
            new.touch()

            def fake_run(arguments, **kwargs):
                if arguments[0] == "/usr/libexec/java_home":
                    return subprocess.CompletedProcess(arguments, 0, str(new.parent.parent))
                major = 26 if Path(arguments[0]) == new.resolve() else 17
                return subprocess.CompletedProcess(arguments, 0, f'openjdk version "{major}.0.1"')

            with patch.object(lifecycle.sys, "platform", "darwin"), patch.object(
                lifecycle.shutil, "which", return_value=str(old)
            ), patch.object(lifecycle, "run", side_effect=fake_run):
                selected = lifecycle.select_java({"PATH": str(old.parent), "JAVA_HOME": str(old.parent.parent)})
            self.assertEqual(selected["JAVA_HOME"], str(new.resolve().parent.parent))
            self.assertTrue(selected["PATH"].startswith(str(new.resolve().parent)))

    def test_docker_opens_and_waits_only_when_starting(self):
        commands = []
        def fake_run(arguments, **kwargs):
            commands.append(arguments)
            return subprocess.CompletedProcess(arguments, 1 if arguments == ["docker", "info"] else 0, "")
        with patch.object(lifecycle.sys, "platform", "darwin"), patch.object(
            lifecycle, "run", side_effect=fake_run
        ), patch.object(lifecycle, "wait_until") as wait:
            lifecycle.ensure_docker({}, True, 240)
        self.assertIn(["open", "-gja", "Docker"], commands)
        self.assertEqual(wait.call_args.args[2], 240)

    def test_stop_never_launches_docker(self):
        with patch.object(lifecycle, "run", return_value=subprocess.CompletedProcess([], 1, "")) as run:
            with self.assertRaises(lifecycle.LifecycleError):
                lifecycle.ensure_docker({}, False)
        self.assertEqual(run.call_count, 1)


class FailureSummaryTests(unittest.TestCase):
    def test_reports_current_description_not_previous_run(self):
        with tempfile.TemporaryDirectory() as directory:
            logs = Path(directory)
            (logs / "subscription-service.log").write_text(
                "Starting OldApplication using Java 23\nDescription:\nOld failure\nAction:\nFix it\n"
                "Starting SubscriptionServiceApplication using Java 23\n"
                "Description:\nMissing Apple service bean\nAction:\nCheck configuration\n"
            )
            with patch.object(lifecycle, "LOGS", logs):
                summary = lifecycle.startup_failure_summary("subscription-service")
            self.assertEqual(summary, "Missing Apple service bean")

    def test_new_run_does_not_reuse_old_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            logs = Path(directory)
            (logs / "group-service.log").write_text(
                "Starting OldApplication using Java 23\nDescription:\nOld failure\n"
                "Starting GroupServiceApplication using Java 23\n"
            )
            with patch.object(lifecycle, "LOGS", logs):
                self.assertEqual(lifecycle.startup_failure_summary("group-service"), "")


class CollectorRecoveryTests(unittest.TestCase):
    def test_finds_collector_without_pid_file(self):
        expected = str(lifecycle.ROOT / "scripts/log_collector.py")
        with patch.object(lifecycle, "process_snapshot", return_value={
            123: "python3 " + expected, 456: "python3 /other/scripts/log_collector.py"
        }):
            self.assertEqual(lifecycle.collector_processes(), {123})

    def test_stop_recovers_orphan_without_pid_file(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(lifecycle, "RUNTIME", Path(directory)), patch.object(
                lifecycle, "collector_processes", side_effect=[{123}, {123}, set()]
            ), patch.object(lifecycle.os, "kill") as kill:
                lifecycle.stop_log_collector()
            kill.assert_called_once_with(123, lifecycle.signal.SIGTERM)


class ResourceDefaultsTests(unittest.TestCase):
    def test_heaps_are_scoped_by_service(self):
        self.assertIn("-Xmx128m", lifecycle.java_options("discovery-service", {}))
        self.assertIn("-Xmx192m", lifecycle.java_options("gateway-service", {}))
        self.assertIn("-Xmx256m", lifecycle.java_options("identity-service", {}))
        self.assertIn("-XX:ActiveProcessorCount=2", lifecycle.java_options("identity-service", {}))

    def test_explicit_options_override_defaults_without_shell_execution(self):
        self.assertEqual(lifecycle.java_options("identity-service", {"SPLITEASE_JAVA_OPTS": "-Xmx512m -XX:+UseG1GC"}),
                         ["-Xmx512m", "-XX:+UseG1GC"])
        with self.assertRaises(lifecycle.LifecycleError):
            lifecycle.java_options("identity-service", {"JAVA_MAX_HEAP": "invalid"})


if __name__ == "__main__":
    unittest.main()
