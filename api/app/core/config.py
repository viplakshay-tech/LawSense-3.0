from pathlib import Path

from app.core.storage_security import ensure_private_directory


API_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = API_ROOT.parents[1]

DATA_DIR = PROJECT_ROOT / "data"
DB_PATH = DATA_DIR / "lawsense.db"

ensure_private_directory(DATA_DIR)