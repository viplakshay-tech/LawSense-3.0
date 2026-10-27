import os
from pathlib import Path


API_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = API_ROOT.parents[1]

DATA_DIR = PROJECT_ROOT / "data"
DB_PATH = DATA_DIR / "lawsense.db"

# Case records and uploaded legal documents are sensitive. On POSIX, keep the
# storage root private to the account running LawSense. Windows ACLs are
# inherited from the parent directory and must be secured at the OS level.
DATA_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
if os.name != "nt":
    DATA_DIR.chmod(0o700)