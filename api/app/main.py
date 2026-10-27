from ipaddress import ip_address

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

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


@app.middleware("http")
async def restrict_api_to_loopback(request: Request, call_next):
    """Reject direct non-local API clients; the Next.js frontend proxies locally."""
    client_host = request.client.host if request.client else ""
    try:
        local_client = ip_address(client_host).is_loopback
    except ValueError:
        local_client = False

    if not local_client:
        return JSONResponse(
            status_code=403,
            content={
                "detail": (
                    "The LawSense API accepts local connections only. "
                    "Use the web workspace on the same computer."
                )
            },
            headers={"Cache-Control": "no-store"},
        )

    return await call_next(request)


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
app.include_router(guide_router)
