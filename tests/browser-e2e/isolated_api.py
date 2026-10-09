"""Run the real LawSense API with a disposable SQLite/document directory."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

import uvicorn


EXPECTED_API_REVISION = "756df0b8cb37207770b93ac7342be255016be485"


def resolve_api_root() -> Path:
    configured_root = os.environ.get("LAWSENSE_API_ROOT")
    if not configured_root:
        raise RuntimeError("LAWSENSE_API_ROOT must identify the pinned LawSense API checkout.")

    api_root = Path(configured_root).expanduser().resolve()
    if not (api_root / "app" / "main.py").is_file():
        raise RuntimeError(f"LAWSENSE_API_ROOT does not contain the LawSense API: {api_root}")

    revision = subprocess.run(
        ["git", "-C", str(api_root), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if revision != EXPECTED_API_REVISION:
        raise RuntimeError(
            f"Expected API revision {EXPECTED_API_REVISION}, found {revision} at {api_root}."
        )

    dirty = subprocess.run(
        ["git", "-C", str(api_root), "status", "--porcelain"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if dirty:
        raise RuntimeError(f"Pinned API checkout has uncommitted changes: {api_root}")

    return api_root


API_ROOT = resolve_api_root()
sys.path.insert(0, str(API_ROOT))


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="lawsense-browser-e2e-") as temp_root:
        from app.core import config

        sandbox = Path(temp_root)
        config.DATA_DIR = sandbox
        config.DB_PATH = sandbox / "lawsense-browser-e2e.sqlite3"

        # The document service passes this directory to its real local processor.
        from app.services import document_service

        document_service.DATA_DIR = sandbox

        from app.main import app

        uvicorn.run(app, host="127.0.0.1", port=8001, log_level="warning")


if __name__ == "__main__":
    main()
