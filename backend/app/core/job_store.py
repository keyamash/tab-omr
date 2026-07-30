"""Short-lived, UUID-addressed MusicXML storage."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
import os
import shutil
import threading
import uuid


@dataclass(frozen=True, slots=True)
class StoredJob:
    """Metadata for a generated MusicXML file."""

    job_id: str
    path: Path
    filename: str
    created_at: datetime


class JobStore:
    """Store generated files outside the public web root and expire them."""

    def __init__(self, root: Path, ttl_seconds: int) -> None:
        self.root = root
        self.ttl = timedelta(seconds=ttl_seconds)
        self._lock = threading.Lock()
        self.root.mkdir(parents=True, exist_ok=True)

    def create(self, content: bytes) -> StoredJob:
        """Create an isolated job directory and write its MusicXML."""

        self.cleanup()
        job_id = str(uuid.uuid4())
        created_at = datetime.now(UTC)
        job_dir = self.root / job_id
        job_dir.mkdir()
        if os.name != "nt":
            job_dir.chmod(0o700)
        filename = f"tab-score-{created_at.astimezone().strftime('%Y%m%d-%H%M%S')}.musicxml"
        path = job_dir / "score.musicxml"
        path.write_bytes(content)
        return StoredJob(job_id, path, filename, created_at)

    def get(self, job_id: str) -> StoredJob | None:
        """Return a live job, rejecting malformed or expired identifiers."""

        try:
            uuid.UUID(job_id)
        except ValueError:
            return None
        job_dir = self.root / job_id
        path = job_dir / "score.musicxml"
        if not path.is_file():
            return None
        created_at = datetime.fromtimestamp(path.stat().st_mtime, UTC)
        if datetime.now(UTC) - created_at > self.ttl:
            shutil.rmtree(job_dir, ignore_errors=True)
            return None
        filename = f"tab-score-{created_at.astimezone().strftime('%Y%m%d-%H%M%S')}.musicxml"
        return StoredJob(job_id, path, filename, created_at)

    def cleanup(self) -> None:
        """Remove expired UUID job directories."""

        now = datetime.now(UTC)
        with self._lock:
            for child in self.root.iterdir():
                if not child.is_dir():
                    continue
                try:
                    uuid.UUID(child.name)
                    modified = datetime.fromtimestamp(child.stat().st_mtime, UTC)
                except (ValueError, OSError):
                    continue
                if now - modified > self.ttl:
                    shutil.rmtree(child, ignore_errors=True)
