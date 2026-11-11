"""Docker-only PostgreSQL backup and isolated restore rehearsal. Requires Python 3 on Unix."""
import argparse
import contextlib
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import uuid

INFRA = Path(__file__).resolve().parent.parent
IMAGE = "postgres:16-alpine"
OWN_DUMP = re.compile(r"^ahosaji-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}\.dump$")


def command(args, **kwargs):
    return subprocess.run(["docker", *args], check=True, **kwargs)


def regular_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError(f"Expected a regular file: {path.name}")
    return info


def checksum(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@contextlib.contextmanager
def backup_lock(directory):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("Backup directory must be an owned, non-symlink directory with mode 0700")
    fd = os.open(directory / ".backup.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError("Backup lock must be a regular file")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("Another backup is already running") from None
        yield
    finally:
        os.close(fd)


def verify_dump(dump):
    regular_file(dump)
    sidecar = dump.with_name(dump.name + ".sha256")
    regular_file(sidecar)
    expected = sidecar.read_text(encoding="utf-8")
    actual = f"{checksum(dump)}  {dump.name}\n"
    if expected != actual:
        raise ValueError("Backup checksum verification failed")


def retain(directory, keep):
    completed = []
    for candidate in directory.iterdir():
        if not OWN_DUMP.fullmatch(candidate.name):
            continue
        try:
            info = regular_file(candidate)
            regular_file(candidate.with_name(candidate.name + ".sha256"))
        except (FileNotFoundError, ValueError):
            continue
        completed.append((info.st_mtime_ns, candidate.name, candidate))
    for _, _, candidate in sorted(completed, reverse=True)[keep:]:
        candidate.unlink()
        candidate.with_name(candidate.name + ".sha256").unlink()


def backup(args):
    directory = args.directory.absolute()
    with backup_lock(directory):
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        dump = directory / f"ahosaji-{stamp}-{uuid.uuid4().hex[:12]}.dump"
        temporary = directory / ("." + dump.name + ".partial")
        sidecar = dump.with_name(dump.name + ".sha256")
        checksum_temporary = directory / ("." + sidecar.name + ".partial")
        finalized = False
        try:
            if args.container:
                if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", args.container):
                    raise ValueError("Invalid source container name")
                source = ["exec", args.container]
            else:
                source = ["compose", "-f", str(INFRA / "docker-compose.yml"), "exec", "-T", "postgres"]
            with temporary.open("xb") as output:
                command([*source, "sh", "-c", 'exec pg_dump --format=custom --no-owner --no-acl --username="${POSTGRES_USER:-postgres}" --dbname="${POSTGRES_DB:-${POSTGRES_USER:-postgres}}"'], stdout=output)
                output.flush()
                os.fsync(output.fileno())
            with temporary.open("rb") as source:
                command(["run", "--rm", "--network", "none", "--interactive", IMAGE, "pg_restore", "--list"], stdin=source, stdout=subprocess.DEVNULL)
            with checksum_temporary.open("x", encoding="utf-8") as output:
                output.write(f"{checksum(temporary)}  {dump.name}\n")
                output.flush()
                os.fsync(output.fileno())
            temporary.rename(dump)
            checksum_temporary.rename(sidecar)  # The checksum sidecar is the completion marker.
            finalized = True
            retain(directory, args.keep)
            print(dump)
        finally:
            temporary.unlink(missing_ok=True)
            checksum_temporary.unlink(missing_ok=True)
            if not finalized:
                dump.unlink(missing_ok=True)
                sidecar.unlink(missing_ok=True)


def rehearse(args):
    dump = args.dump.absolute()
    verify_dump(dump)  # Fail before starting Docker if artifacts changed.
    name = "ahosaji-restore-drill-" + uuid.uuid4().hex[:12]
    started = False
    try:
        command(["run", "--detach", "--name", name, "--network", "none",
                 "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "--env", "POSTGRES_DB=ahosaji_restore_drill",
                 "--tmpfs", "/var/lib/postgresql/data:rw,noexec,nosuid", IMAGE], stdout=subprocess.DEVNULL)
        started = True
        for _ in range(60):
            # The official image starts/stops a socket-only server during initdb.
            # TCP readiness identifies the final server after initialization completes.
            ready = subprocess.run(["docker", "exec", name, "pg_isready", "--host", "127.0.0.1", "--username", "postgres", "--dbname", "ahosaji_restore_drill"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ready.returncode == 0:
                break
            time.sleep(0.25)
        else:
            raise ValueError("Isolated restore database did not become ready")
        with dump.open("rb") as source:
            command(["exec", "--interactive", name, "pg_restore", "--username", "postgres", "--dbname", "ahosaji_restore_drill",
                     "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction"], stdin=source)
        query = """SELECT json_build_object(
          'translations', (SELECT count(*) FROM translations),
          'books', (SELECT count(*) FROM books),
          'verses', (SELECT count(*) FROM verses),
          'migrations', (SELECT count(*) FROM schema_migrations));"""
        result = command(["exec", name, "psql", "--username", "postgres", "--dbname", "ahosaji_restore_drill",
                          "--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--command", query], capture_output=True, text=True)
        counts = json.loads(result.stdout)
        if counts["migrations"] < 3:
            raise ValueError("Restored database is missing expected migration history")
        print(json.dumps({"restore": "passed", **counts}, sort_keys=True))
    finally:
        if started:
            command(["rm", "--force", name], stdout=subprocess.DEVNULL)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    dump = commands.add_parser("backup", help="Create a custom-format backup and retain completed backup pairs")
    dump.add_argument("--directory", type=Path, default=INFRA / "backups")
    dump.add_argument("--container", help="Explicit source container; defaults to this repository's Compose postgres service")
    dump.add_argument("--keep", type=int, default=30, help="Number of completed backups to retain (default: 30)")
    restore = commands.add_parser("rehearse", help="Restore into a disposable container with no network or persistent storage")
    restore.add_argument("dump", type=Path)
    args = parser.parse_args()
    if args.command == "backup":
        if args.keep < 1:
            parser.error("--keep must be at least 1")
        backup(args)
    else:
        rehearse(args)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Backup operation failed: {error}", file=sys.stderr)
        sys.exit(1)
