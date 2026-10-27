import ipaddress
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.db.database import init_db
from app.routes.analysis import router as analysis_router
from app.routes.cases import router as cases_router
from app.routes.clarification import router as clarification_router
from app.routes.document_review import router as document_review_router
from app.routes.document_compiler import router as document_compiler_router
from app.routes.guide import router as guide_router
from app.routes.journey_execution import router as journey_execution_router
from app.routes.legal_sources import router as legal_sources_router
from app.routes.safety_support import router as safety_support_router
from app.services.voice_case import build_voice_case_service


init_db()

app = FastAPI(
    title="LawSense API",
    version="0.1.0",
)
# The configured local Whisper model loads only on its first request; without
# its model directory the service reports audio STT unavailable.
app.state.voice_case_service = build_voice_case_service()


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        # Capacitor's bundled Android WebView uses https://localhost by default.
        # The local shell uses this origin only for its explicit /api/health check.
        "https://localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "lawsense-api",
        "version": "0.1.0",
    }


app.include_router(cases_router)
app.include_router(clarification_router)
app.include_router(analysis_router)
app.include_router(document_review_router)
app.include_router(document_compiler_router)
app.include_router(safety_support_router)
app.include_router(journey_execution_router)
app.include_router(legal_sources_router)

_REMOTE_API_FLAG = os.getenv("LAWSENSE_ALLOW_REMOTE_API", "").strip().casefold() in {"1", "true", "yes"}


def _is_local_api_client(host: str | None) -> bool:
    """Allow only loopback peers by default; 'testclient' is an in-process ASGI test sentinel."""
    if host == "testclient":
        return True
    if not host:
        return False
    # IPv6 zone identifiers are not part of the IP address syntax accepted by ip_address().
    candidate = host.split("%", 1)[0]
    try:
        return ipaddress.ip_address(candidate).is_loopback
    except ValueError:
        return False


@app.middleware("http")
async def restrict_direct_api_network_access(request: Request, call_next):
    """Keep the raw API loopback-only by default; Next.js proxies to 127.0.0.1."""
    if not _REMOTE_API_FLAG and not _is_local_api_client(
        request.client.host if request.client else None
    ):
        return JSONResponse(
            status_code=403,
            content={
                "detail": (
                    "Direct network access to the LawSense API is disabled by default. "
                    "Use the same-origin frontend /api route. For a trusted isolated "
                    "development network only, set LAWSENSE_ALLOW_REMOTE_API=true; "
                    "this switch does not add authentication."
                )
            },
            headers={"Cache-Control": "no-store"},
        )
    response = await call_next(request)
    response.headers.setdefault("Cache-Control", "no-store")
    return response


app.include_router(guide_router)
