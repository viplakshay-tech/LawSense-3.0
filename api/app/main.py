from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.network_guard import LocalOnlyApiMiddleware
from app.core.auth_middleware import SessionAuthenticationMiddleware
from app.db.database import CaseAccessDeniedError, CasePermanentlyDeletedError, init_db
from app.routes.auth import router as auth_router
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

# Added after CORS so the local-boundary policy wraps every API route.
# The Next.js same-machine rewrite reaches FastAPI over loopback.
app.add_middleware(SessionAuthenticationMiddleware)
app.add_middleware(LocalOnlyApiMiddleware)


@app.exception_handler(CaseAccessDeniedError)
async def case_access_denied_handler(
    request: Request,
    exc: CaseAccessDeniedError,
) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"detail": "Case not found"},
        headers={"Cache-Control": "no-store"},
    )


@app.exception_handler(CasePermanentlyDeletedError)
async def permanently_deleted_case_handler(
    request: Request,
    exc: CasePermanentlyDeletedError,
) -> JSONResponse:
    return JSONResponse(
        status_code=410,
        content={"detail": str(exc)},
        headers={"Cache-Control": "no-store"},
    )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "lawsense-api",
        "version": "0.1.0",
    }


app.include_router(auth_router)
app.include_router(cases_router)
app.include_router(clarification_router)
app.include_router(analysis_router)
app.include_router(document_review_router)
app.include_router(document_compiler_router)
app.include_router(safety_support_router)
app.include_router(journey_execution_router)
app.include_router(legal_sources_router)
app.include_router(guide_router)
