#!/usr/bin/env python3
"""Local SplitEase lifecycle. No third-party Python packages are required."""

import argparse
import fcntl
import hashlib
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ROOT / ".runtime"
LOGS = ROOT / "logs"
INSTANCE = hashlib.sha256(str(ROOT).encode()).hexdigest()[:24]
MARKER = "-Dsplitease.instance=" + INSTANCE
SERVICES = (
    ("discovery-service", 9897, None),
    ("group-service", 9892, "groups"),
    ("identity-service", 9891, "identity"),
    ("expense-service", 9893, "expenses"),
    ("settlement-service", 9894, "settlements"),
    ("subscription-service", 9895, "subscriptions"),
    ("notification-service", 9896, "notifications"),
    ("gateway-service", 9890, None),
)
COMPOSE = ["docker", "compose", "--project-directory", str(ROOT), "-f", str(ROOT / "compose.yml")]


class LifecycleError(Exception):
    pass


def announce(message):
    print(message, flush=True)


def run(arguments, *, env=None, capture=False, check=True, input_text=None, timeout=120):
    result = subprocess.run(
        arguments, cwd=ROOT, env=env, text=True, input=input_text,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None, timeout=timeout,
    )
    if check and result.returncode:
        # Do not print captured Docker configuration, passwords, or provider credentials.
        raise LifecycleError("Command failed: " + " ".join(arguments[:3]))
    return result


def load_environment(create=False):
    path = ROOT / ".env"
    if not path.exists() and create:
        text = (ROOT / ".env.example").read_text()
        replacements = {
            "POSTGRES_PASSWORD": secrets.token_urlsafe(24),
            "JWT_SECRET": secrets.token_urlsafe(48),
            "INTERNAL_SERVICE_KEY": secrets.token_urlsafe(48),
            "GOOGLE_APPLICATION_CREDENTIALS": "",
        }
        for key, value in replacements.items():
            text = re.sub(r"(?m)^" + key + r"=.*$", key + "=" + value, text)
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w") as output:
                output.write(text)
            announce("Created .env with random local database and application secrets.")
        except FileExistsError:
            pass
    env = dict(os.environ)
    if path.exists():
        for number, line in enumerate(path.read_text().splitlines(), 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[7:]
            key, separator, value = line.partition("=")
            if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
                raise LifecycleError("Invalid .env assignment at line " + str(number))
            value = value.strip()
            if value.startswith(("'", '"')):
                if len(value) < 2 or value[-1] != value[0]:
                    raise LifecycleError("Unclosed .env quote at line " + str(number))
                value = value[1:-1]
            else:
                value = value.split(" #", 1)[0].rstrip()
            # .env is data, never shell code. Environment overrides are supported.
            env.setdefault(key, value)
    for key, default in (("POSTGRES_USER", "splitease"), ("POSTGRES_PASSWORD", "change-me")):
        env.setdefault(key, default)
    return env


def java_major(output):
    match = re.search(r'(?:version\s+"?|openjdk\s+)(\d+)(?:\.(\d+))?', output)
    if not match:
        return None
    major = int(match.group(1))
    return int(match.group(2)) if major == 1 and match.group(2) else major


def select_java(env):
    """Select an installed supported JDK, without changing the user's shell settings."""
    candidates = []
    if env.get("JAVA_HOME"):
        candidates.append(Path(env["JAVA_HOME"]) / "bin/java")
    current = shutil.which("java", path=env.get("PATH"))
    if current:
        candidates.append(Path(current))
    if sys.platform == "darwin":
        inventory = run(["/usr/libexec/java_home", "-V"], capture=True, check=False)
        for line in inventory.stdout.splitlines():
            match = re.search(r"(/.*?/Contents/Home)\s*$", line)
            if match:
                candidates.append(Path(match.group(1)) / "bin/java")
        for parent in (Path.home() / "Library/Java/JavaVirtualMachines",
                       Path("/Library/Java/JavaVirtualMachines")):
            candidates.extend(parent.glob("*/Contents/Home/bin/java"))
        for prefix in (Path("/opt/homebrew/opt"), Path("/usr/local/opt")):
            candidates.extend(prefix.glob("openjdk*/libexec/openjdk.jdk/Contents/Home/bin/java"))
    else:
        candidates.extend(Path("/usr/lib/jvm").glob("*/bin/java"))
    supported = []
    seen = set()
    for candidate in candidates:
        candidate = candidate.resolve()
        if sys.platform == "darwin" and candidate == Path("/usr/bin/java"):
            # macOS's launcher stub is not a JDK home; inspect the installed homes instead.
            continue
        if candidate in seen or not candidate.is_file():
            continue
        seen.add(candidate)
        try:
            result = run([str(candidate), "-version"], env=env, capture=True, check=False, timeout=15)
        except (OSError, subprocess.TimeoutExpired):
            continue
        major = java_major(result.stdout)
        if result.returncode == 0 and major is not None and major >= 21:
            supported.append((major, candidate))
    if not supported:
        raise LifecycleError("No installed JDK 21+ was found. Install JDK 21, or set JAVA_HOME to a supported JDK.")
    # Prefer the project's Java 21 baseline; otherwise use the lowest installed supported version.
    major, executable = min(supported, key=lambda candidate: candidate[0])
    selected = dict(env)
    selected["JAVA_HOME"] = str(executable.parent.parent)
    selected["PATH"] = str(executable.parent) + os.pathsep + env.get("PATH", "")
    announce("Using Java " + str(major) + " from " + selected["JAVA_HOME"])
    return selected


def ensure_docker(env, starting, timeout=180):
    def ready():
        try:
            return run(["docker", "info"], env=env, capture=True,
                       check=False, timeout=10).returncode == 0
        except subprocess.TimeoutExpired:
            return False

    if ready():
        return
    if not starting:
        raise LifecycleError("Docker is not running. Java services were stopped; containers could not be stopped.")
    if sys.platform != "darwin":
        raise LifecycleError("Docker is not running. Start Docker Engine, then rerun ./start.sh.")
    if env.get("DOCKER_HOST") and not env["DOCKER_HOST"].startswith("unix://"):
        raise LifecycleError("The configured remote DOCKER_HOST is unavailable; check that daemon.")
    announce("Docker is not running. Opening Docker Desktop...")
    opened = run(["open", "-gja", "Docker"], env=env, capture=True, check=False, timeout=15)
    if opened.returncode != 0:
        raise LifecycleError("Docker Desktop could not be opened. Install Docker Desktop for macOS first.")
    wait_until("Docker Desktop daemon", ready, timeout)
    announce("Docker Desktop is ready.")


def check_dependencies(starting, env=None, docker_timeout=180):
    env = dict(os.environ if env is None else env)
    if starting:
        env = select_java(env)
    desktop_bin = Path("/Applications/Docker.app/Contents/Resources/bin")
    if sys.platform == "darwin" and not shutil.which("docker", path=env.get("PATH")) and desktop_bin.is_dir():
        env["PATH"] = str(desktop_bin) + os.pathsep + env.get("PATH", "")
    required = ["docker", "ps"] + (["mvn", "lsof"] if starting else [])
    missing = [name for name in required if shutil.which(name, path=env.get("PATH")) is None]
    if missing:
        raise LifecycleError("Install required tools: " + ", ".join(missing))
    run(["docker", "compose", "version"], env=env, capture=True)
    if starting:
        maven = run(["mvn", "-version"], env=env, capture=True).stdout
        maven = re.sub(r"\x1b\[[0-9;]*m", "", maven)
        match = re.search(r"Apache Maven (\d+)\.(\d+)\.(\d+)", maven)
        if not match or tuple(map(int, match.groups())) < (3, 6, 3):
            raise LifecycleError("Maven 3.6.3 or newer is required.")
        match = re.search(r"Java version: (\d+)", maven)
        if not match or int(match.group(1)) < 21:
            raise LifecycleError("Maven is overriding the selected JDK. Check your Maven startup configuration.")
    ensure_docker(env, starting, docker_timeout)
    return env


def validate_configuration(env):
    for key in ("JWT_SECRET", "INTERNAL_SERVICE_KEY"):
        value = env.get(key, "")
        if len(value.encode()) < 32 or value.startswith("replace-with-"):
            raise LifecycleError("Set a unique secret of at least 32 bytes for " + key + " in .env.")
    if not env["POSTGRES_PASSWORD"] or env["POSTGRES_PASSWORD"] == "change-me":
        raise LifecycleError("Set POSTGRES_PASSWORD in .env; the example password is not accepted.")
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", env["POSTGRES_USER"]):
        raise LifecycleError("POSTGRES_USER must be a simple PostgreSQL role name.")
    # This launcher deliberately owns the local Compose infrastructure and fixed service ports.
    for key in ("DATABASE_URL", "SERVER_PORT", "SPRING_DATASOURCE_URL"):
        if env.get(key):
            raise LifecycleError("Unset " + key + " for this local multi-service launcher.")
    credentials = env.get("GOOGLE_APPLICATION_CREDENTIALS", "")
    if env.get("FIREBASE_PROJECT_ID") or env.get("GOOGLE_PLAY_VERIFICATION_ENABLED", "").lower() == "true":
        if credentials and not Path(credentials).is_file():
            raise LifecycleError("GOOGLE_APPLICATION_CREDENTIALS does not point to a readable server credential file.")
    if not env.get("FIREBASE_PROJECT_ID"):
        announce("Firebase project is unset: Google login will stay unavailable until configured.")


def process_snapshot():
    output = run(["ps", "-axo", "pid=,command="], capture=True).stdout
    processes = {}
    for line in output.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[0].isdigit():
            processes[int(parts[0])] = parts[1]
    return processes


def belongs_to_project(command):
    # Never identify ownership from a port or generic service name alone.
    executable = command.split(" -", 1)[0]
    if Path(executable).name != "java":
        return False
    if re.search(r"(?:^|\s)" + re.escape(MARKER) + r"(?:\s|$)", command):
        return True
    return any(
        ("-jar " in command and str(ROOT / name / "target") + "/" in command
         and re.search(re.escape(name) + r"-[^/\s]+\.jar(?:\s|$)", command))
        or (str(ROOT / name / "target" / "classes") in command
            and "com.splitease." in command and "ServiceApplication" in command)
        for name, _, _ in SERVICES
    )


def stop_java():
    processes = {pid for pid, command in process_snapshot().items() if belongs_to_project(command)}
    if not processes:
        announce("No running SplitEase Java services found.")
        return
    announce("Stopping " + str(len(processes)) + " SplitEase Java services...")
    for sig, seconds in ((signal.SIGTERM, 30), (signal.SIGKILL, 5)):
        for pid in list(processes):
            command = process_snapshot().get(pid, "")
            if not belongs_to_project(command):
                processes.discard(pid)
                continue
            try:
                os.kill(pid, sig)
            except ProcessLookupError:
                processes.discard(pid)
        deadline = time.monotonic() + seconds
        while processes and time.monotonic() < deadline:
            snapshot = process_snapshot()
            processes = {pid for pid in processes if belongs_to_project(snapshot.get(pid, ""))}
            if processes:
                time.sleep(0.5)
        if not processes:
            break
    if processes:
        raise LifecycleError("Some SplitEase processes could not be stopped.")
    for path in RUNTIME.glob("*.pid"):
        path.unlink(missing_ok=True)


def wait_until(label, check, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(2)
    raise LifecycleError("Timed out waiting for " + label + ". Check logs/ and docker compose logs.")


def compose_probe(env, service, arguments):
    return run(COMPOSE + ["exec", "-T", service] + arguments,
               env=env, capture=True, check=False, timeout=20).returncode == 0


def prepare_infrastructure(env):
    announce("Starting PostgreSQL, Kafka and Redis...")
    run(COMPOSE + ["up", "-d", "postgres", "kafka", "redis"], env=env, timeout=600)
    wait_until("PostgreSQL", lambda: compose_probe(env, "postgres", [
        "pg_isready", "-U", env["POSTGRES_USER"], "-d", "postgres"]), 120)
    wait_until("Redis", lambda: compose_probe(env, "redis", ["redis-cli", "ping"]), 120)
    wait_until("Kafka", lambda: compose_probe(env, "kafka", [
        "/opt/kafka/bin/kafka-topics.sh", "--bootstrap-server", "localhost:9092", "--list"]), 180)
    announce("Creating any missing service databases (existing data is preserved)...")
    # psql identifier quoting and gexec avoid non-idempotent CREATE DATABASE on existing volumes.
    sql = "\n".join(
        "SELECT format('CREATE DATABASE %I', 'splitease_" + database + "') "
        "WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'splitease_" + database + "')\n\\gexec"
        for database in [item[2] for item in SERVICES if item[2]] + ["logs"]
    ) + "\n"
    run(COMPOSE + ["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1",
                   "-U", env["POSTGRES_USER"], "-d", "postgres"], env=env, input_text=sql)
    # Check password authentication over TCP, not only the container's trusted Unix socket.
    for _, _, database in SERVICES:
        if database:
            run(COMPOSE + ["exec", "-T", "postgres", "sh", "-c",
                'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_USER" '
                '-d "$1" -v ON_ERROR_STOP=1 -c "SELECT 1"', "sh", "splitease_" + database],
                env=env, capture=True)

    announce("Preparing the shared service/API log database...")
    run(COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1",
                   "-U", env["POSTGRES_USER"], "-d", "splitease_logs"],
        env=env, input_text=(ROOT / "scripts/log_schema.sql").read_text())


def port_listeners(port):
    result = run(["lsof", "-nP", "-t", "-iTCP:" + str(port), "-sTCP:LISTEN"],
                 capture=True, check=False)
    if result.returncode not in (0, 1):
        raise LifecycleError("Unable to inspect listeners on port " + str(port))
    return {int(value) for value in result.stdout.split() if value.isdigit()}


def release_port(port):
    for sig, timeout in ((signal.SIGTERM, 10), (signal.SIGKILL, 5)):
        listeners = port_listeners(port)
        if not listeners:
            return
        announce("Stopping listeners on port " + str(port) + ": " + ", ".join(map(str, sorted(listeners))))
        for pid in listeners:
            if pid in (os.getpid(), os.getppid()):
                raise LifecycleError("Refusing to terminate the launcher's own process.")
            try:
                os.kill(pid, sig)
            except ProcessLookupError:
                pass
            except PermissionError as error:
                raise LifecycleError("Permission denied stopping PID " + str(pid) + " on port " + str(port)) from error
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if not port_listeners(port):
                return
            time.sleep(0.25)
    raise LifecycleError("Port " + str(port) + " is still occupied; its process may be restarting automatically.")


def check_ports():
    for _, port, _ in SERVICES:
        release_port(port)
        with socket.socket() as connection:
            connection.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                connection.bind(("127.0.0.1", port))
            except OSError as error:
                raise LifecycleError("Port " + str(port) + " could not be released.") from error


def startup_failure_summary(name):
    path = LOGS / (name + ".log")
    try:
        text = path.read_text(errors="replace")[-24000:]
    except OSError:
        return ""
    # Logs append across runs. Never report a previous run's failure.
    starts = list(re.finditer(r"Starting \S+ using Java", text))
    if starts:
        text = text[starts[-1].start():]
    description = re.search(r"Description:\s*\n(.*?)(?:\nAction:|\Z)", text, re.DOTALL)
    if description:
        return description.group(1).strip()[:2000]
    causes = re.findall(r"^Caused by: (.+)$", text, re.MULTILINE)
    return causes[-1][:2000] if causes else ""


def service_ready(process, port, name):
    if process.poll() is not None:
        summary = startup_failure_summary(name)
        detail = "\nReason: " + summary if summary else ""
        raise LifecycleError(name + " exited. See logs/" + name + ".log." + detail)
    try:
        with urllib.request.urlopen("http://127.0.0.1:" + str(port) + "/actuator/health", timeout=3) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def java_options(service, env):
    custom = env.get("SPLITEASE_JAVA_OPTS", "").strip()
    if custom:
        options = shlex.split(custom)
        if not options or any(not option.startswith("-") for option in options) or "-jar" in options:
            raise LifecycleError("SPLITEASE_JAVA_OPTS must contain JVM options only.")
        return options
    default_heap = "128m" if service == "discovery-service" else "192m" if service == "gateway-service" else "256m"
    heap = env.get("JAVA_MAX_HEAP", default_heap)
    processors = env.get("JAVA_ACTIVE_PROCESSORS", "2")
    if not re.fullmatch(r"[1-9][0-9]*[mMgG]", heap):
        raise LifecycleError("JAVA_MAX_HEAP must be a heap size such as 256m or 1g.")
    if not processors.isdigit() or int(processors) < 1:
        raise LifecycleError("JAVA_ACTIVE_PROCESSORS must be a positive integer.")
    options = ["-Xms32m", "-Xmx" + heap, "-XX:ActiveProcessorCount=" + processors, "-XX:+UseSerialGC"]
    if service == "gateway-service":
        options.append("-Dreactor.netty.ioWorkerCount=2")
    return options


def start_services(env, timeout, selected_services=None):
    processes = []
    for name, port, database in (SERVICES if selected_services is None else selected_services):
        jars = [p for p in (ROOT / name / "target").glob(name + "-*.jar") if not p.name.endswith("-sources.jar")]
        if len(jars) != 1:
            raise LifecycleError("Expected exactly one packaged executable JAR for " + name)
        service_env = dict(env)
        service_env.update({
            "SERVER_PORT": str(port), "EUREKA_URL": "http://localhost:9897/eureka/",
            "GROUP_SERVICE_URL": "http://localhost:9892", "KAFKA_BOOTSTRAP_SERVERS": "localhost:9092",
            "REDIS_HOST": "localhost", "REDIS_PORT": "6379",
            "SPRING_FLYWAY_ENABLED": "true", "SPRING_JPA_HIBERNATE_DDL_AUTO": "validate",
        })
        if database:
            service_env["DATABASE_URL"] = "jdbc:postgresql://127.0.0.1:15432/splitease_" + database
        announce("Starting " + name + " on " + str(port) + " (Flyway validates and applies pending migrations)...")
        with (LOGS / (name + ".log")).open("a") as output:
            process = subprocess.Popen(["java", *java_options(name, env), MARKER, "-jar", str(jars[0])], cwd=ROOT,
                                       env=service_env, stdin=subprocess.DEVNULL,
                                       stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        processes.append((process, port, name))
        (RUNTIME / (name + ".pid")).write_text(str(process.pid) + "\n")
        wait_until(name, lambda: service_ready(process, port, name), timeout)
    # Recheck earlier services before claiming a successful startup.
    for process, port, name in processes:
        if not service_ready(process, port, name):
            raise LifecycleError(name + " became unhealthy during startup.")
    def gateway_routes_ready():
        try:
            with urllib.request.urlopen("http://127.0.0.1:9890/api/v1/subscriptions/plans", timeout=3) as response:
                return response.status == 200
        except (OSError, urllib.error.URLError):
            return False

    wait_until("gateway discovery routing", gateway_routes_ready, timeout)
    announce("SplitEase is ready. Gateway: http://localhost:9890 | Discovery: http://localhost:9897")


def collector_processes():
    expected = str(ROOT / "scripts/log_collector.py")
    return {pid for pid, command in process_snapshot().items() if expected in command}


def stop_log_collector():
    path = RUNTIME / "log-collector.pid"
    # The PID file can be missing/stale after interrupted or duplicate startup.
    # Process ownership is verified from this checkout's absolute script path.
    targets = collector_processes()
    if not targets:
        path.unlink(missing_ok=True)
        return
    announce("Flushing application logs to PostgreSQL...")
    for sig, seconds in ((signal.SIGTERM, 35), (signal.SIGKILL, 5)):
        for pid in targets & collector_processes():
            try:
                os.kill(pid, sig)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            targets &= collector_processes()
            if not targets:
                path.unlink(missing_ok=True)
                return
            time.sleep(0.25)
    raise LifecycleError("Log collector could not be stopped; preserved its PID state for retry.")


def start_log_collector(env):
    with (LOGS / "log-collector.log").open("a") as output:
        process = subprocess.Popen([sys.executable, str(ROOT / "scripts/log_collector.py")],
            cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=output,
            stderr=subprocess.STDOUT, start_new_session=True)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise LifecycleError("Log collector exited. See logs/log-collector.log.")
        try:
            if (RUNTIME / "log-collector.pid").read_text().strip() == str(process.pid):
                return
        except OSError:
            pass
        time.sleep(0.1)
    raise LifecycleError("Log collector did not become ready. See logs/log-collector.log.")


def follow_logs(offsets, stop_event=None):
    # This runs after releasing the lifecycle lock so stop.sh remains usable.
    from log_collector import sanitize_line
    announce("Streaming service and API logs. Ctrl+C leaves the backend running; use ./stop.sh to stop it.")
    try:
        while stop_event is None or not stop_event.is_set():
            if not (RUNTIME / "log-collector.pid").exists():
                announce("Log collector stopped; leaving console log stream.")
                return
            for service in [item[0] for item in SERVICES] + ["log-collector"]:
                path = LOGS / (service + ".log")
                if not path.exists():
                    continue
                position = offsets.get(service, 0)
                if path.stat().st_size < position:
                    position = 0
                with path.open("rb") as source:
                    source.seek(position)
                    for _ in range(200):
                        line = source.readline()
                        if not line or not line.endswith(b"\n"):
                            break
                        announce("[" + service + "] " + sanitize_line(line.decode("utf-8", errors="replace").rstrip()))
                        offsets[service] = source.tell()
            time.sleep(0.3)
    except KeyboardInterrupt:
        announce("Stopped following logs. Backend and database log collector remain running.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("start", "stop"))
    parser.add_argument("--timeout", type=int, default=180, help="health timeout per Java service, in seconds")
    parser.add_argument("--docker-timeout", type=int, default=180, help="Docker Desktop startup timeout in seconds")
    parser.add_argument("--detach", action="store_true", help="return after startup instead of streaming logs")
    parser.add_argument("--watch", action="store_true", help="development: rebuild/restart on source changes")
    args = parser.parse_args()
    if args.watch and (args.detach or args.action != "start"):
        parser.error("--watch requires foreground start and cannot be combined with --detach")
    if args.timeout < 1 or args.docker_timeout < 1:
        parser.error("--timeout must be positive")
    RUNTIME.mkdir(mode=0o700, exist_ok=True)
    LOGS.mkdir(mode=0o700, exist_ok=True)
    with (RUNTIME / "lifecycle.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise LifecycleError("Another SplitEase start/stop operation is already running.") from error
        # Stop Java even if Docker is unavailable; report the infrastructure error afterward.
        if args.action == "stop":
            stop_java()
            stop_log_collector()
            env = load_environment()
            env = check_dependencies(False, env)
            run(COMPOSE + ["stop", "--timeout", "30"], env=env, timeout=180)
            announce("SplitEase stopped. Database and Redis volumes are preserved.")
            return
        env = load_environment(create=True)
        env = check_dependencies(True, env, args.docker_timeout)
        validate_configuration(env)
        if args.watch:
            env.setdefault("SPRING_PROFILES_ACTIVE", "dev")
        run(COMPOSE + ["config", "--quiet"], env=env, capture=True)
        announce("Resolving Maven dependencies and packaging all services (tests are skipped)...")
        # Fail a build before interrupting a working stack. The parent binds repackage for service modules.
        run(["mvn", "-B", "-DskipTests", "clean", "package",
             "-pl", ",".join(name for name, _, _ in SERVICES), "-am"], env=env, timeout=1800)
        offsets = {name: (LOGS / (name + ".log")).stat().st_size
                   if (LOGS / (name + ".log")).exists() else 0 for name, _, _ in SERVICES}
        cleanup_needed = False
        try:
            cleanup_needed = True
            stop_java()
            stop_log_collector()
            run(COMPOSE + ["stop", "--timeout", "30"], env=env, timeout=180)
            check_ports()
            prepare_infrastructure(env)
            start_log_collector(env)
            start_services(env, args.timeout)
            cleanup_needed = False
        finally:
            if cleanup_needed:
                announce("Startup did not complete; stopping the partial SplitEase stack...")
                stop_java()
                stop_log_collector()
                run(COMPOSE + ["stop", "--timeout", "30"], env=env, check=False, timeout=180)

    if args.action == "start" and args.watch:
        from dev_watch import run_watch
        run_watch(sys.modules[__name__], env, args.timeout, offsets)
    elif args.action == "start" and not args.detach:
        follow_logs(offsets)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        main()
    except (LifecycleError, OSError, subprocess.TimeoutExpired) as error:
        print("SplitEase: " + str(error), file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("SplitEase operation interrupted.", file=sys.stderr)
        sys.exit(130)
