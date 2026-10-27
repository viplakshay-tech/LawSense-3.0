"""Local-first account and opaque session management for LawSense."""

from __future__ import annotations
import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from app.db.database import get_connection

SESSION_TTL = timedelta(hours=12)
USERNAME_RE = re.compile(r"^[a-z0-9._-]{3,32}$")
_DUMMY_SALT = b"LawSenseDummySalt"

class RegistrationClosedError(RuntimeError):
    """The first local owner account has already been created."""

def normalize_username(username: str) -> str:
    normalized = username.strip().casefold()
    if not USERNAME_RE.fullmatch(normalized):
        raise ValueError("Username must be 3–32 characters: letters, numbers, dot, underscore or hyphen.")
    return normalized

def hash_password(password: str, salt: bytes) -> bytes:
    if not isinstance(password, str) or not 12 <= len(password) <= 128:
        raise ValueError("Password must contain between 12 and 128 characters.")
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)

def setup_required() -> bool:
    with get_connection() as connection:
        return connection.execute("SELECT COUNT(*) FROM auth_users").fetchone()[0] == 0

def create_first_account(username: str, password: str) -> dict[str, str]:
    username = normalize_username(username)
    salt = secrets.token_bytes(16)
    digest = hash_password(password, salt)
    user_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with get_connection() as connection:
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute("SELECT 1 FROM auth_users LIMIT 1").fetchone() is not None:
            connection.rollback()
            raise RegistrationClosedError("Initial account setup is already complete.")
        try:
            connection.execute(
                "INSERT INTO auth_users (id, username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, username, salt.hex(), digest.hex(), now),
            )
            connection.execute("UPDATE cases SET owner_user_id = ? WHERE owner_user_id IS NULL", (user_id,))
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {"id": user_id, "username": username}

def verify_credentials(username: str, password: str) -> dict[str, str] | None:
    try:
        normalized = normalize_username(username)
    except ValueError:
        normalized = ""
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id, username, password_salt, password_hash FROM auth_users WHERE username = ?",
            (normalized,),
        ).fetchone()
    if row is None:
        try:
            hash_password(password, _DUMMY_SALT)
        except ValueError:
            pass
        return None
    try:
        candidate = hash_password(password, bytes.fromhex(row["password_salt"]))
    except (ValueError, TypeError):
        return None
    if not secrets.compare_digest(candidate, bytes.fromhex(row["password_hash"])):
        return None
    return {"id": row["id"], "username": row["username"]}

def create_session(user_id: str) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    expires_at = now + SESSION_TTL
    with get_connection() as connection:
        connection.execute(
            "INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
            (token_hash, user_id, now.isoformat(), expires_at.isoformat()),
        )
        connection.commit()
    return token, expires_at

def resolve_session(token: str | None) -> dict[str, str] | None:
    if not token or len(token) > 256:
        return None
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with get_connection() as connection:
        row = connection.execute(
            """SELECT u.id, u.username, s.expires_at FROM auth_sessions AS s
               JOIN auth_users AS u ON u.id = s.user_id WHERE s.token_hash = ?""",
            (token_hash,),
        ).fetchone()
        if row is None:
            return None
        try:
            expires_at = datetime.fromisoformat(row["expires_at"])
        except (TypeError, ValueError):
            expires_at = datetime.fromtimestamp(0, timezone.utc)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            connection.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))
            connection.commit()
            return None
    return {"id": row["id"], "username": row["username"]}

def revoke_session(token: str | None) -> None:
    if not token or len(token) > 256:
        return
    token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
    with get_connection() as connection:
        connection.execute("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))
        connection.commit()
