from pathlib import Path


API_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = API_ROOT.parents[1]

DATA_DIR = PROJECT_ROOT / "data"
DB_PATH = DATA_DIR / "lawsense.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)