"""Debounced source watcher for the local development launcher."""

import fcntl
from pathlib import Path
import re
import signal
import threading
import time


def snapshot(root, services):
    paths = [root / "pom.xml", root / ".env", root / "serviceAccountKey.json"]
    for module in ["common"] + [name for name, _, _ in services]:
        paths.append(root / module / "pom.xml")
        paths.extend((root / module / "src/main").rglob("*"))
    result = {}
    for path in paths:
        try:
            if path.is_file():
                stat = path.stat()
                result[str(path.relative_to(root))] = (stat.st_mtime_ns, stat.st_size)
        except FileNotFoundError:
            pass
    return result


def environment_services(keys, services, root):
    names = {name for name, _, _ in services}
    selected = set()
    for name in names:
        configuration = root / name / "src/main/resources/application.yml"
        references = set(re.findall(r"\$\{([A-Z_][A-Z0-9_]*)", configuration.read_text())) if configuration.exists() else set()
        if references & keys:
            selected.add(name)
    # These settings are consumed by Java directly or by framework configuration.
    if "FIREBASE_PROJECT_ID" in keys:
        selected.add("identity-service")
    if "GOOGLE_APPLICATION_CREDENTIALS" in keys:
        selected.update({"identity-service", "subscription-service"})
    if keys & {"SPRING_PROFILES_ACTIVE", "SPLITEASE_JAVA_OPTS", "JAVA_MAX_HEAP", "JAVA_ACTIVE_PROCESSORS"}:
        selected.update(names)
    return selected & names


def affected_services(changed, services, env_keys=None, root=None):
    names = {name for name, _, _ in services}
    selected = set()
    for path in changed:
        module = Path(path).parts[0]
        if path == "pom.xml":
            return names
        if path == ".env":
            selected.update(environment_services(env_keys or set(), services, root or Path.cwd()))
        elif path == "serviceAccountKey.json":
            selected.update({"identity-service", "subscription-service"} & names)
        elif module == "common":
            selected.update(names - {"discovery-service", "gateway-service"})
        elif module in names:
            selected.add(module)
    return selected


def restart_services(lifecycle, selected, env, timeout):
    processes = lifecycle.process_snapshot()
    targets = {pid for pid, command in processes.items()
               if lifecycle.belongs_to_project(command) and any(
                   str(lifecycle.ROOT / name / "target") + "/" in command for name in selected)}
    for sig, wait in ((signal.SIGTERM, 30), (signal.SIGKILL, 5)):
        for pid in targets:
            command = lifecycle.process_snapshot().get(pid, "")
            if lifecycle.belongs_to_project(command):
                try:
                    lifecycle.os.kill(pid, sig)
                except ProcessLookupError:
                    pass
        deadline = time.monotonic() + wait
        while time.monotonic() < deadline:
            current = lifecycle.process_snapshot()
            targets = {pid for pid in targets if lifecycle.belongs_to_project(current.get(pid, ""))}
            if not targets:
                break
            time.sleep(0.25)
        if not targets:
            break
    if targets:
        raise lifecycle.LifecycleError("Could not stop affected development services.")
    services = [service for service in lifecycle.SERVICES if service[0] in selected]
    for _, port, _ in services:
        lifecycle.release_port(port)
    lifecycle.start_services(env, timeout, selected_services=services)


def run_watch(lifecycle, env, timeout, offsets):
    stop = threading.Event()
    state = snapshot(lifecycle.ROOT, lifecycle.SERVICES)
    last_environment = lifecycle.load_environment()
    pending = set()
    last_change = 0
    stream = threading.Thread(target=lifecycle.follow_logs, args=(offsets, stop), daemon=True)
    stream.start()
    lifecycle.announce("Development auto-reload enabled. Save source/resources to rebuild affected services. Ctrl+C stops watching and leaves services running.")
    try:
        while (lifecycle.RUNTIME / "log-collector.pid").exists():
            current = snapshot(lifecycle.ROOT, lifecycle.SERVICES)
            changed = {path for path in state.keys() | current.keys() if state.get(path) != current.get(path)}
            if changed:
                pending.update(changed)
                last_change = time.monotonic()
                state = current
            if pending and time.monotonic() - last_change >= 0.8:
                with (lifecycle.RUNTIME / "lifecycle.lock").open("a") as lock:
                    try:
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    except BlockingIOError:
                        time.sleep(0.5)
                        continue
                    batch = set(pending)
                    pending.clear()
                    try:
                        updated_env = lifecycle.load_environment()
                        env_keys = {key for key in last_environment.keys() | updated_env.keys()
                                    if last_environment.get(key) != updated_env.get(key)}
                        selected = affected_services(batch, lifecycle.SERVICES, env_keys, lifecycle.ROOT)
                        if not selected:
                            last_environment = updated_env
                            continue
                        lifecycle.announce("File changes: " + ", ".join(sorted(batch)))
                        source_change = any(path not in {".env", "serviceAccountKey.json"} for path in batch)
                        lifecycle.announce(("Rebuilding: " if source_change else "Restarting: ") + ", ".join(sorted(selected)))
                        next_environment = dict(updated_env)
                        # Reuse the selected JDK without caching .env provider/application settings.
                        updated_env["JAVA_HOME"] = env["JAVA_HOME"]
                        updated_env["PATH"] = env["PATH"]
                        updated_env.setdefault("SPRING_PROFILES_ACTIVE", "dev")
                        lifecycle.validate_configuration(updated_env)
                        if source_change:
                            lifecycle.run(["mvn", "-B", "-DskipTests", "clean", "package", "-pl",
                                           ",".join(sorted(selected)), "-am"], env=updated_env, timeout=1800)
                        restart_services(lifecycle, selected, updated_env, timeout)
                        last_environment = next_environment
                        lifecycle.announce("Development reload complete.")
                    except Exception as failure:
                        lifecycle.announce("Development reload failed: " + str(failure))
                        lifecycle.announce("Fix the error and save again to retry. Other services and infrastructure remain running.")
            time.sleep(1.0)
    except KeyboardInterrupt:
        lifecycle.announce("Auto-reload stopped. Backend remains running; use ./stop.sh to stop it.")
    finally:
        stop.set()
        stream.join(timeout=2)
