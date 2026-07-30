"""Environment-driven application configuration."""

from dataclasses import dataclass
import os
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    """Runtime settings with secure, development-friendly defaults."""

    cors_origins: tuple[str, ...] = tuple(
        item.strip()
        for item in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
        if item.strip()
    )
    max_files: int = int(os.getenv("MAX_FILES", "20"))
    max_file_bytes: int = int(os.getenv("MAX_FILE_BYTES", str(10 * 1024 * 1024)))
    max_pixels: int = int(os.getenv("MAX_IMAGE_PIXELS", "40000000"))
    job_ttl_seconds: int = int(os.getenv("JOB_TTL_SECONDS", "3600"))
    temp_dir: Path = Path(
        os.getenv("TAB_OMR_TEMP_DIR", str(Path.cwd() / ".tab-omr-jobs"))
    )
    debug: bool = os.getenv("APP_DEBUG", "false").lower() == "true"


settings = Settings()
