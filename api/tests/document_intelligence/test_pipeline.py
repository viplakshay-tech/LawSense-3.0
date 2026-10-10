from __future__ import annotations

import hashlib
import os
import re
import unittest
from datetime import datetime
from unittest.mock import patch

from app.engines.document_intelligence import DocumentProcessingStatus, EvidenceStatus, process_document
from app.engines.document_intelligence.ocr import OCRProviderAvailability, OCRRecognition
from app.engines.document_intelligence.pipeline import DocumentProcessingError
from app.engines.document_intelligence.validation import DocumentValidationError


def make_pdf(page_texts: list[str]) -> bytes:
    """Build a tiny standards-shaped PDF fixture without external packages."""
    page_ids = [3 + 2 * index for index in range(len(page_texts))]
    content_ids = [page_id + 1 for page_id in page_ids]
    font_id = 3 + 2 * len(page_texts)
    objects: dict[int, bytes] = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: ("<< /Type /Pages /Kids [" + " ".join(f"{item} 0 R" for item in page_ids) + f"] /Count {len(page_ids)} >>").encode("ascii"),
        font_id: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    }
    for page_id, content_id, text in zip(page_ids, content_ids, page_texts):
        objects[page_id] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>"
        ).encode("ascii")
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET".encode("ascii")
        objects[content_id] = f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream"

    result = bytearray(b"%PDF-1.4\n")
    offsets = [0] * (max(objects) + 1)
    for object_id in sorted(objects):
        offsets[object_id] = len(result)
        result.extend(f"{object_id} 0 obj\n".encode("ascii"))
        result.extend(objects[object_id])
        result.extend(b"\nendobj\n")
    xref_offset = len(result)
    result.extend(f"xref\n0 {len(offsets)}\n".encode("ascii"))
    result.extend(b"0000000000 65535 f \n")
    for object_id in range(1, len(offsets)):
        result.extend(f"{offsets[object_id]:010d} 00000 n \n".encode("ascii"))
    result.extend(
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n".encode("ascii")
    )
    return bytes(result)


class _TestOCR:
    def extract_text(self, document_bytes: bytes, *, mime_type: str, page_number: int) -> str:
        return f"Recognized page {page_number}"


class _PageAwareOCR:
    name = "test-local-ocr"

    def __init__(self) -> None:
        self.calls: list[tuple[bytes, str, int]] = []

    @property
    def availability(self) -> OCRProviderAvailability:
        return OCRProviderAvailability(self.name, True)

    def recognize_page(self, document_bytes: bytes, *, mime_type: str, page_number: int) -> OCRRecognition:
        self.calls.append((document_bytes, mime_type, page_number))
        return OCRRecognition(f"Scanned page {page_number}", 0.91)


class DocumentIntelligenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.pdf = make_pdf([
            "RENT AGREEMENT between Asha Rao and Ravi Shah.",
            "Monthly rent is INR 30,000. Signed on 2025-03-04.",
        ])

    def test_metadata_extraction(self) -> None:
        result = process_document(self.pdf, "rental.pdf")
        self.assertEqual(result.metadata.filename, "rental.pdf")
        self.assertEqual(result.metadata.mime_type, "application/pdf")
        self.assertEqual(result.metadata.extension, ".pdf")
        self.assertEqual(result.metadata.file_size, len(self.pdf))
        self.assertEqual(result.metadata.page_count, 2)
        self.assertIsNotNone(datetime.fromisoformat(result.metadata.processing_timestamp).tzinfo)

    def test_sha256_hashing(self) -> None:
        result = process_document(self.pdf, "rental.pdf")
        self.assertEqual(result.metadata.sha256, hashlib.sha256(self.pdf).hexdigest())

    def test_pdf_text_extraction_is_page_by_page(self) -> None:
        result = process_document(self.pdf, "rental.pdf")
        self.assertIn("RENT AGREEMENT", result.pages[0].text)
        self.assertIn("INR 30,000", result.pages[1].text)
        self.assertEqual([page.page_number for page in result.pages], [1, 2])

    def test_image_type_and_document_classification(self) -> None:
        png = b"\x89PNG\r\n\x1a\n" + b"test image payload"
        result = process_document(png, "scan.PNG")
        self.assertEqual(result.metadata.mime_type, "image/png")
        self.assertEqual(result.classification.category, "unknown")
        self.assertEqual(result.status, DocumentProcessingStatus.OCR_REQUIRED)
        self.assertEqual(result.pages[0].text, "")

        invoice = process_document(make_pdf(["INVOICE No. 14. Bill to Asha Rao."]), "bill.pdf")
        self.assertEqual(invoice.classification.category, "invoice")

    def test_page_level_provenance(self) -> None:
        result = process_document(self.pdf, "rental.pdf", document_id="rental-1")
        amount = next(item for item in result.evidence if item.field == "amount")
        self.assertEqual(amount.document_id, "rental-1")
        self.assertEqual(amount.page_number, 2)
        self.assertEqual(amount.value, "30000")
        self.assertEqual(amount.source, "document")
        self.assertEqual(amount.status, EvidenceStatus.EVIDENCE_SUPPORTED)
        self.assertIn(amount.extraction_method, {"simple_pdf", "pypdf"})

    def test_missing_ocr_backend_is_reported_without_fake_text(self) -> None:
        jpeg = b"\xff\xd8\xff" + b"sample image bytes"
        with patch.dict(os.environ, {"LAW_SENSE_OCR_PROVIDER": "none"}):
            result = process_document(jpeg, "photo.jpeg")
        self.assertEqual(result.status, DocumentProcessingStatus.OCR_REQUIRED)
        self.assertEqual(result.pages[0].extraction_method, "none")
        self.assertEqual(result.pages[0].text, "")
        self.assertTrue(any("no local OCR backend" in message for message in result.errors))

        with_ocr = process_document(jpeg, "photo.jpeg", ocr_backend=_TestOCR())
        self.assertEqual(with_ocr.pages[0].text, "Recognized page 1")
        self.assertEqual(with_ocr.pages[0].extraction_method, "ocr")

    def test_scanned_image_uses_configured_provider_and_preserves_confidence(self) -> None:
        png = b"\x89PNG\r\n\x1a\n" + b"fixture image data"
        provider = _PageAwareOCR()

        result = process_document(png, "scan.png", ocr_provider=provider)

        self.assertEqual(result.status, DocumentProcessingStatus.EXTRACTED)
        self.assertEqual(result.pages[0].page_number, 1)
        self.assertEqual(result.pages[0].text, "Scanned page 1")
        self.assertEqual(result.pages[0].extraction_method, "ocr")
        self.assertEqual(result.pages[0].confidence, 0.91)
        self.assertEqual(result.pages[0].provider_name, provider.name)
        self.assertEqual(provider.calls, [(png, "image/png", 1)])

    def test_scanned_pdf_runs_ocr_only_on_textless_pages(self) -> None:
        pdf = make_pdf(["Digitally readable first page", ""])
        provider = _PageAwareOCR()

        result = process_document(pdf, "mixed.pdf", ocr_provider=provider)

        self.assertEqual(result.status, DocumentProcessingStatus.EXTRACTED)
        self.assertEqual([page.page_number for page in result.pages], [1, 2])
        self.assertIn(result.pages[0].extraction_method, {"pypdf", "simple_pdf"})
        self.assertEqual(result.pages[0].text, "Digitally readable first page")
        self.assertEqual(result.pages[1].text, "Scanned page 2")
        self.assertEqual(result.pages[1].extraction_method, "ocr")
        self.assertEqual(result.pages[1].confidence, 0.91)
        self.assertEqual(provider.calls, [(pdf, "application/pdf", 2)])

    def test_unavailable_configured_ocr_provider_is_reported(self) -> None:
        png = b"\x89PNG\r\n\x1a\n" + b"fixture image data"
        with patch.dict(
            os.environ,
            {
                "LAW_SENSE_OCR_PROVIDER": "tesseract",
                "LAW_SENSE_TESSERACT_CMD": "missing-tesseract-for-test.exe",
            },
        ):
            result = process_document(png, "scan.png")

        self.assertEqual(result.status, DocumentProcessingStatus.OCR_REQUIRED)
        self.assertEqual(result.pages[0].text, "")
        self.assertEqual(result.pages[0].provider_name, "tesseract")
        self.assertTrue(any("Tesseract executable was not found" in error for error in result.errors))

    def test_amount_extraction_and_explicit_currency(self) -> None:
        result = process_document(make_pdf(["Rent: INR 30,000 per month."]), "rent.pdf")
        values = {(item.field, item.value) for item in result.evidence}
        self.assertIn(("amount", "30000"), values)
        self.assertIn(("currency", "INR"), values)

    def test_date_extraction(self) -> None:
        result = process_document(make_pdf(["Dated March 4, 2025."]), "notice.pdf")
        date = next(item for item in result.evidence if item.field == "date")
        self.assertEqual(date.value, "March 4, 2025")
        self.assertEqual(date.page_number, 1)

    def test_unrecognized_text_classifies_as_unknown(self) -> None:
        result = process_document(make_pdf(["Keep this paper in a safe place." ]), "paper.pdf")
        self.assertEqual(result.classification.category, "unknown")
        self.assertEqual(result.status, DocumentProcessingStatus.EXTRACTED)

    def test_malformed_file_is_rejected(self) -> None:
        with self.assertRaises(DocumentValidationError):
            process_document(b"not a real PDF", "broken.pdf")
        with self.assertRaises(DocumentProcessingError):
            process_document(b"%PDF-1.4\nnot an object", "broken.pdf")


if __name__ == "__main__":
    unittest.main()
