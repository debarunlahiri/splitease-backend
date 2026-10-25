#!/usr/bin/env python3
"""Durably copy application log files into PostgreSQL with restart-safe cursors."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import sys
import time

from lifecycle import COMPOSE, LOGS, ROOT, RUNTIME, SERVICES, load_environment, run

STOP = False


def request_stop(*_):
    global STOP
    STOP = True


def sanitize_line(line):
    # Existing development senders can emit tokens; don't copy them to the audit database/console.
    if re.search(r"local email verification|verification.*token|password|client.secret|private.key|refresh.token|access.token", line, re.I) and "API_AUDIT " not in line:
        return "[SENSITIVE LOG LINE REDACTED]"
    line = re.sub(r"Bearer\s+[^\s\"']+", "Bearer [REDACTED]", line, flags=re.I)
    line = re.sub(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b", "[JWT REDACTED]", line)
    return line.replace("\x00", "")


def record(service, identity, offset, text):
    text = sanitize_line(text)
    details = None
    if "API_AUDIT " in text:
        try:
            details = json.loads(text.split("API_AUDIT ", 1)[1])
        except ValueError:
            pass
    return {"service": service, "identity": identity, "offset": offset, "text": text, "api": details}


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def insert_sql(records):
    rows = []
    for item in records:
        api = "NULL" if item["api"] is None else sql_literal(json.dumps(item["api"], ensure_ascii=True)) + "::jsonb"
        rows.append("(" + ",".join([sql_literal(item["service"]), sql_literal(item["identity"]),
                    str(item["offset"]), sql_literal(item["text"]), api]) + ")")
    return ("BEGIN;\nSET LOCAL standard_conforming_strings = on;\n"
            "INSERT INTO service_logs(service_name,file_identity,byte_offset,log_text,api_details) VALUES\n"
            + ",\n".join(rows) + "\nON CONFLICT (service_name,file_identity,byte_offset) DO NOTHING;\nCOMMIT;\n")


def read_batch(cursors, limit=250):
    records = []
    updated = dict(cursors)
    for service, _, _ in SERVICES:
        path = LOGS / (service + ".log")
        if not path.exists():
            continue
        with path.open("rb") as source:
            stat = os.fstat(source.fileno())
            inode = str(stat.st_dev) + ":" + str(stat.st_ino)
            previous = updated.get(service, {})
            same_file = previous.get("inode", previous.get("identity")) == inode
            identity = previous.get("identity", inode) if same_file else inode
            offset = previous.get("offset", 0) if same_file else 0
            if offset > stat.st_size:
                # Treat an in-place truncation as a new log generation.
                identity += ":" + str(stat.st_mtime_ns)
                offset = 0
            source.seek(offset)
            while len(records) < limit:
                start = source.tell()
                line = source.readline()
                if not line or not line.endswith(b"\n"):
                    break
                records.append(record(service, identity, start, line.decode("utf-8", errors="replace").rstrip("\r\n")))
                updated[service] = {"inode": inode, "identity": identity, "offset": source.tell()}
    return records, updated


def persist(records, env):
    run(COMPOSE + ["exec", "-T", "postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-q",
                   "-U", env["POSTGRES_USER"], "-d", "splitease_logs"],
        env=env, input_text=insert_sql(records), capture=True, timeout=30)


def collect():
    env = load_environment()
    RUNTIME.mkdir(mode=0o700, exist_ok=True)
    cursor_path = RUNTIME / "log-cursors.json"
    with (RUNTIME / "log-collector.lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("A log collector is already running.")
        # Publish readiness only after acquiring the exclusive collector lock.
        pid_file = RUNTIME / "log-collector.pid"
        temporary_pid = RUNTIME / ("log-collector.pid." + str(os.getpid()) + ".tmp")
        temporary_pid.write_text(str(os.getpid()) + "\n")
        temporary_pid.replace(pid_file)
        try:
            cursors = json.loads(cursor_path.read_text())
        except (OSError, ValueError):
            cursors = {}
        while True:
            records, updated = read_batch(cursors)
            if records:
                try:
                    persist(records, env)
                    temporary = cursor_path.with_suffix(".tmp")
                    temporary.write_text(json.dumps(updated))
                    temporary.replace(cursor_path)
                    cursors = updated
                except Exception as failure:
                    print("Log database write failed; source files retained for retry: " + type(failure).__name__, flush=True)
                    if STOP:
                        return
                    time.sleep(3)
                    continue
            if STOP and not records:
                return
            if len(records) < 250 and not STOP:
                # Batch normal traffic to avoid spawning Docker/psql for each individual log line.
                time.sleep(2.0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    collect()
