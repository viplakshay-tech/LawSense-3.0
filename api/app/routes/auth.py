"""Bootstrap and session endpoints for the local-first LawSense app."""

from __future__ import annotations
import ipaddress
from urllib.parse import urlsplit
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from app.core.auth_middleware import SESSION_COOKIE
from app.services import auth_service
from app.services.auth_service import RegistrationClosedError

router = APIRouter(prefix="/auth", tags=["authentication"])

class CredentialsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=12, max_length=128)
    setupToken: str | None = Field(default=None, min_length=32, max_length=128)

class UserResponse(BaseModel):
    userId: str
    username: str

def _is_loopback_browser_bootstrap(request: Request) -> bool:
    """Only permit initial ownership claims from a browser opened on the host PC."""
    client = request.client.host if request.client else ""
    if client not in {"testclient", "testserver"}:
        try:
            if not ipaddress.ip_address(client.split("%", maxsplit=1)[0]).is_loopback:
                return False
        except ValueError:
            return False
    origin = request.headers.get("origin", "")
    if not origin:
        return False
    try:
        parsed = urlsplit(origin)
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
            return False
        hostname = parsed.hostname.casefold()
        if hostname == "localhost":
            return True
        return ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return False

def _set_session_cookie(response: Response, request: Request, token: str, max_age: int) -> None:
    secure = request.headers.get("origin", "").casefold().startswith("https://")
    response.set_cookie(
        key=SESSION_COOKIE, value=token, max_age=max_age, httponly=True,
        secure=secure, samesite="strict", path="/",
    )
    response.headers["Cache-Control"] = "no-store"

@router.get("/setup-status")
def read_setup_status() -> dict[str, bool]:
    return {"setupRequired": auth_service.setup_required()}

@router.post("/register", response_model=UserResponse, status_code=201)
def register_first_account(payload: CredentialsRequest, request: Request, response: Response) -> UserResponse:
    if not auth_service.setup_required():
        raise HTTPException(status_code=409, detail="Initial account setup is already complete.")
    if not _is_loopback_browser_bootstrap(request):
        raise HTTPException(status_code=403, detail="Initial setup must be completed from a browser on the host computer.")
    if not auth_service.verify_setup_token(payload.setupToken):
        raise HTTPException(
            status_code=403,
            detail="A valid local setup code is required. Read lawsense.setup-token beside the local database on the host computer.",
        )
    try:
        user = auth_service.create_first_account(payload.username, payload.password)
    except RegistrationClosedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    token, _expires = auth_service.create_session(user["id"])
    _set_session_cookie(response, request, token, int(auth_service.SESSION_TTL.total_seconds()))
    return UserResponse(userId=user["id"], username=user["username"])

@router.post("/login", response_model=UserResponse)
def login(payload: CredentialsRequest, request: Request, response: Response) -> UserResponse:
    user = auth_service.verify_credentials(payload.username, payload.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    token, _expires = auth_service.create_session(user["id"])
    _set_session_cookie(response, request, token, int(auth_service.SESSION_TTL.total_seconds()))
    return UserResponse(userId=user["id"], username=user["username"])

@router.post("/logout")
def logout(request: Request, response: Response) -> dict[str, bool]:
    auth_service.revoke_session(request.cookies.get(SESSION_COOKIE))
    response.delete_cookie(
        key=SESSION_COOKIE, path="/", httponly=True,
        secure=request.headers.get("origin", "").casefold().startswith("https://"),
        samesite="strict",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"loggedOut": True}

@router.get("/me", response_model=UserResponse)
def read_current_user(request: Request) -> UserResponse:
    user = getattr(request.state, "auth_user", None)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return UserResponse(userId=user["id"], username=user["username"])
