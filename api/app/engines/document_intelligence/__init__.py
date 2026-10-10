"""Local-first document intake and evidence extraction primitives."""

from app.engines.document_intelligence.models import (
    Classification,
    DocumentMetadata,
    DocumentProcessingStatus,
    DocumentResult,
    Evidence,
    EvidenceStatus,
    PageText,
)
from app.engines.document_intelligence.ocr import (
    OCRBackend,
    OCRProvider,
    OCRProviderAvailability,
    OCRRecognition,
)
from app.engines.document_intelligence.ocr_settings import OCRSettings
from app.engines.document_intelligence.page_extraction import (
    ExtractionMethod,
    MinimumTextSufficiency,
    PageExtractionCoordinator,
    PageExtractionResult,
    PageExtractionStatus,
    TextSufficiencyEvaluator,
)
from app.engines.document_intelligence.pipeline import DocumentProcessingError, process_document
from app.engines.document_intelligence.structured_extraction import StructuredExtractor
from app.engines.document_intelligence.validation import DocumentValidationError

__all__ = [
    "Classification",
    "DocumentMetadata",
    "DocumentProcessingStatus",
    "DocumentResult",
    "Evidence",
    "EvidenceStatus",
    "OCRBackend",
    "OCRProvider",
    "OCRProviderAvailability",
    "OCRRecognition",
    "OCRSettings",
    "ExtractionMethod",
    "MinimumTextSufficiency",
    "PageExtractionCoordinator",
    "PageExtractionResult",
    "PageExtractionStatus",
    "PageText",
    "StructuredExtractor",
    "TextSufficiencyEvaluator",
    "DocumentProcessingError",
    "DocumentValidationError",
    "process_document",
]
