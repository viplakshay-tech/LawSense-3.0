from typing import Literal, cast

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.engines.document_intelligence.validation import (
    MAX_DOCUMENT_SIZE_BYTES,
    DocumentValidationError,
)
from app.schemas.case_state import CaseState, EvidenceProvenance
from app.schemas.documents import DocumentUploadResponse, ExtractedDocumentValue
from app.schemas.legal_twin import LegalTwinSummary, TwinDeltaSummary, TwinSnapshotSummary
from app.services.case_service import create_case_from_statement, get_case_state
from app.services.privacy.case_deletion import delete_case_locally
from app.services.case_pipeline import run_persisted_case_pipeline
from app.services.document_service import document_fact_key, upload_document_for_case
from app.services.legal_twin_service import build_case_twin, build_case_twin_delta, build_case_twin_snapshot
from app.engines.voice import AudioInput, ProviderUnavailableError, VoiceLanguage, VoiceProcessingResult
from app.engines.voice.models import VoiceProcessingStatus
from app.services.voice_case import VoiceCaseError, VoiceCaseService, build_voice_case_service


router = APIRouter(prefix="/cases", tags=["cases"])


class DeleteCaseRequest(BaseModel):
    confirmation_phrase: Literal["DELETE"]
    case_id_confirmation: str = Field(..., min_length=1, max_length=64)


class DeleteCaseResponse(BaseModel):
    case_id: str
    status: Literal["deleted"] = "deleted"
    data_records_removed: bool = True
    uploaded_documents_removed: bool
    cleanup_warning: str | None = None
    minimal_tombstone_retained: bool = True


class CreateCaseRequest(BaseModel):
    initialStatement: str = Field(..., min_length=1)
    title: str | None = None
    language: str | None = None
    personName: str | None = None
    inputMethod: str = Field(default="text", pattern="^(text|voice)$")


class VoiceTranscriptRequest(BaseModel):
    transcript: str = Field(..., min_length=1, max_length=30_000)
    inputMethod: str = Field(default="voice", pattern="^(text|voice)$")


class VoiceTranscriptResponse(BaseModel):
    status: VoiceProcessingStatus
    transcript: str | None = None
    detectedLanguage: str | None = None
    language: str | None = None
    caseState: CaseState | None = None
    detail: str | None = None


class VoiceCommitResponse(BaseModel):
    status: str = "success"
    caseId: str
    sourceId: str
    language: str
    transcript: str
    caseState: CaseState


class VoiceProviderStatusResponse(BaseModel):
    speechToTextAvailable: bool
    languageDetectorAvailable: bool
    speechToTextProvider: str | None = None
    processingLocation: str
    textToSpeechAvailable: bool
    textToSpeechProvider: str | None = None
    textToSpeechProcessingLocation: str
    detail: str | None = None


class VoiceSynthesisRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=30_000)
    language: VoiceLanguage


def get_voice_case_service(request: Request) -> VoiceCaseService:
    """Resolve the app's configured service or build its environment-backed default."""
    service = getattr(request.app.state, "voice_case_service", None)
    if service is not None:
        return cast(VoiceCaseService, service)
    return build_voice_case_service()


def _transcription_response(result: VoiceProcessingResult) -> VoiceTranscriptResponse:
    return VoiceTranscriptResponse(
        status=result.status,
        transcript=result.transcript,
        detectedLanguage=result.detected_language,
        language=result.language.value if result.language else None,
        caseState=result.case_state,
        detail=result.detail,
    )


@router.post("", response_model=CaseState, status_code=201)
def create_case(payload: CreateCaseRequest):
    try:
        return create_case_from_statement(
            initial_statement=payload.initialStatement,
            title=payload.title,
            language=payload.language,
            person_name=payload.personName,
            source_id="voice-initial-statement" if payload.inputMethod == "voice" else "initial-statement",
            source_title=(
                "User-reviewed voice transcript"
                + (f" · {payload.language.title()}" if payload.language in {"english", "hindi", "hinglish"} else "")
                if payload.inputMethod == "voice"
                else "Initial user statement"
            ),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc


@router.post("/voice/transcribe", response_model=VoiceTranscriptResponse)
async def transcribe_voice_audio(
    file: UploadFile = File(...),
    service: VoiceCaseService = Depends(get_voice_case_service),
):
    """Run the configured audio provider without saving the draft CaseState."""
    max_audio_size = 25 * 1024 * 1024
    audio_bytes = await file.read(max_audio_size + 1)
    if len(audio_bytes) > max_audio_size:
        raise HTTPException(status_code=413, detail="Audio exceeds the 25 MiB size limit.")
    result = await run_in_threadpool(
        service.transcribe_audio,
        AudioInput(data=audio_bytes, media_type=file.content_type or ""),
    )
    return _transcription_response(result)


@router.get("/voice/status", response_model=VoiceProviderStatusResponse)
def voice_provider_status(service: VoiceCaseService = Depends(get_voice_case_service)):
    """Expose provider readiness so the UI can show unavailable before recording."""
    speech_available = service.speech_to_text_available
    detector_available = service.language_detector_available
    detail = None
    if not speech_available:
        detail = "No configured speech-to-text provider is available."
    elif not detector_available:
        detail = "The configured language detector is unavailable."
    return VoiceProviderStatusResponse(
        speechToTextAvailable=speech_available,
        languageDetectorAvailable=detector_available,
        speechToTextProvider=service.speech_to_text_provider_name,
        processingLocation=service.speech_to_text_processing_location,
        textToSpeechAvailable=service.text_to_speech_available,
        textToSpeechProvider=service.text_to_speech_provider_name,
        textToSpeechProcessingLocation=service.text_to_speech_processing_location,
        detail=detail,
    )


@router.post("/voice/synthesize")
async def synthesize_voice_response(
    payload: VoiceSynthesisRequest,
    service: VoiceCaseService = Depends(get_voice_case_service),
):
    """Synthesize a response with the configured local TTS provider."""
    try:
        audio = await run_in_threadpool(service.synthesize_speech, payload.text, payload.language)
    except ProviderUnavailableError as exc:
        raise HTTPException(status_code=503, detail="Local speech output is unavailable.") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Local speech output failed.") from exc
    if not audio:
        raise HTTPException(status_code=500, detail="Local speech output returned no audio.")
    return Response(content=audio, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@router.post("/voice/preview", response_model=VoiceTranscriptResponse)
def preview_voice_transcript(
    payload: VoiceTranscriptRequest,
    service: VoiceCaseService = Depends(get_voice_case_service),
):
    """Detect language and extract a draft CaseState without committing it."""
    try:
        result = service.preview_transcript(payload.transcript)
    except VoiceCaseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return VoiceTranscriptResponse(
        status=result.status,
        transcript=result.transcript,
        detectedLanguage=result.detected_language,
        language=result.language.value if result.language else None,
        caseState=result.case_state,
        detail=result.detail,
    )


@router.post("/{case_id}/voice", response_model=VoiceCommitResponse)
def add_voice_statement(
    case_id: str,
    payload: VoiceTranscriptRequest,
    service: VoiceCaseService = Depends(get_voice_case_service),
):
    """Commit a user-reviewed voice transcript to an existing CaseState."""
    if get_case_state(case_id) is None:
        raise HTTPException(status_code=404, detail="Case not found")
    try:
        updated, source_id, language = service.add_reviewed_transcript(
            case_id,
            payload.transcript,
            input_method=payload.inputMethod,
        )
    except VoiceCaseError as exc:
        raise HTTPException(status_code=422, detail=f"{exc.status.value}: {exc}") from exc
    return VoiceCommitResponse(
        caseId=case_id,
        sourceId=source_id,
        language=language.value,
        transcript=payload.transcript,
        caseState=updated,
    )


@router.post(
    "/{case_id}/documents",
    response_model=DocumentUploadResponse,
    status_code=201,
)
async def upload_case_document(case_id: str, file: UploadFile = File(...)):
    """Upload one supported document using a ``file`` multipart field."""
    uploaded_bytes = await file.read(MAX_DOCUMENT_SIZE_BYTES + 1)
    if len(uploaded_bytes) > MAX_DOCUMENT_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Document exceeds the {MAX_DOCUMENT_SIZE_BYTES}-byte size limit.",
        )

    try:
        uploaded = await run_in_threadpool(
            upload_document_for_case,
            case_id,
            uploaded_bytes,
            file.filename or "",
        )
    except DocumentValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if uploaded is None:
        raise HTTPException(status_code=404, detail="Case not found")

    updated_case, result, document = uploaded
    values = [
        ExtractedDocumentValue(
            field=document_fact_key(item, result),
            value=item.value,
            provenance=EvidenceProvenance(
                documentId=item.document_id,
                pageNumber=item.page_number,
                confidence=item.confidence,
                status="unknown",
                extractionMethod=item.extraction_method,
            ),
        )
        for item in result.evidence
    ]
    return DocumentUploadResponse(
        caseId=case_id,
        documentId=result.document_id,
        processingStatus=result.status.value,
        document=document,
        extractedValues=values,
    )


@router.delete("/{case_id}", response_model=DeleteCaseResponse)
def delete_case(case_id: str, payload: DeleteCaseRequest) -> DeleteCaseResponse:
    """Permanently remove a local case after an explicit phrase and case-ID confirmation."""
    if payload.confirmation_phrase != "DELETE" or payload.case_id_confirmation != case_id:
        raise HTTPException(
            status_code=400,
            detail="Deletion requires the exact word DELETE and the matching case ID.",
        )
    try:
        result = delete_case_locally(case_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    if not result.deleted:
        raise HTTPException(status_code=404, detail="Case not found")

    return DeleteCaseResponse(
        case_id=case_id,
        data_records_removed=True,
        uploaded_documents_removed=result.uploaded_documents_removed,
        cleanup_warning=result.cleanup_warning,
        minimal_tombstone_retained=True,
    )


@router.get("/{case_id}", response_model=CaseState)
def read_case(case_id: str):
    case = get_case_state(case_id)

    if case is None:
        raise HTTPException(
            status_code=404,
            detail="Case not found",
        )

    return case


@router.get("/{case_id}/twin", response_model=LegalTwinSummary)
def read_legal_twin(case_id: str, as_of: str | None = Query(default=None)):
    case = get_case_state(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    try:
        pipeline = run_persisted_case_pipeline(case)
        return build_case_twin(pipeline.case_state, as_of=as_of)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{case_id}/twin/snapshot", response_model=TwinSnapshotSummary)
def read_legal_twin_snapshot(case_id: str, as_of: str = Query(..., min_length=1)):
    case = get_case_state(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    try:
        pipeline = run_persisted_case_pipeline(case)
        return build_case_twin_snapshot(pipeline.case_state, as_of=as_of)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{case_id}/twin/delta", response_model=TwinDeltaSummary)
def read_legal_twin_delta(
    case_id: str,
    from_as_of: str = Query(..., min_length=1),
    to_as_of: str = Query(..., min_length=1),
):
    case = get_case_state(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    try:
        pipeline = run_persisted_case_pipeline(case)
        return build_case_twin_delta(
            pipeline.case_state,
            from_as_of=from_as_of,
            to_as_of=to_as_of,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
