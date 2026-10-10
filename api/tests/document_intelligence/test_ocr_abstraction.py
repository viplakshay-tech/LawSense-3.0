from __future__ import annotations

import unittest

from app.engines.document_intelligence.ocr import OCRProviderAvailability, OCRRecognition
from app.engines.document_intelligence.page_extraction import (
    ExtractionMethod,
    MinimumTextSufficiency,
    PageExtractionCoordinator,
    PageExtractionStatus,
)


class FakeOCRProvider:
    name = "fake-local-ocr"

    def __init__(self, recognition: OCRRecognition | Exception) -> None:
        self.recognition = recognition
        self.calls: list[tuple[bytes, str, int]] = []

    @property
    def availability(self) -> OCRProviderAvailability:
        return OCRProviderAvailability(self.name, True)

    def recognize_page(
        self,
        document_bytes: bytes,
        *,
        mime_type: str,
        page_number: int,
    ) -> OCRRecognition:
        self.calls.append((document_bytes, mime_type, page_number))
        if isinstance(self.recognition, Exception):
            raise self.recognition
        return self.recognition


class OCRAbstractionTests(unittest.TestCase):
    def test_sufficient_digital_text_skips_ocr(self) -> None:
        provider = FakeOCRProvider(OCRRecognition("should not be used", 0.99))
        result = PageExtractionCoordinator(ocr_provider=provider).extract_page(
            b"document",
            mime_type="application/pdf",
            page_number=2,
            digital_text=" Digitally extracted text ",
        )

        self.assertEqual(result.page_number, 2)
        self.assertEqual(result.text, " Digitally extracted text ")
        self.assertEqual(result.extraction_method, ExtractionMethod.DIGITAL_TEXT)
        self.assertEqual(result.status, PageExtractionStatus.EXTRACTED)
        self.assertFalse(result.ocr_required)
        self.assertIsNone(result.confidence)
        self.assertEqual(provider.calls, [])

    def test_insufficient_digital_text_requires_ocr(self) -> None:
        provider = FakeOCRProvider(OCRRecognition("recognized words", 0.8))
        coordinator = PageExtractionCoordinator(
            ocr_provider=provider,
            sufficiency_evaluator=MinimumTextSufficiency(minimum_characters=5),
        )

        result = coordinator.extract_page(
            b"document",
            mime_type="application/pdf",
            page_number=3,
            digital_text="  x  ",
        )

        self.assertTrue(result.ocr_required)
        self.assertEqual(provider.calls, [(b"document", "application/pdf", 3)])

    def test_missing_provider_is_explicitly_unavailable(self) -> None:
        result = PageExtractionCoordinator().extract_page(
            b"image",
            mime_type="image/png",
            page_number=1,
            digital_text=None,
        )

        self.assertEqual(result.page_number, 1)
        self.assertEqual(result.text, "")
        self.assertEqual(result.extraction_method, ExtractionMethod.UNAVAILABLE)
        self.assertEqual(result.status, PageExtractionStatus.UNAVAILABLE)
        self.assertTrue(result.ocr_required)
        self.assertIsNone(result.confidence)
        self.assertIn("no OCR provider", result.error or "")

    def test_configured_but_unavailable_provider_is_explicitly_reported(self) -> None:
        class UnavailableProvider(FakeOCRProvider):
            @property
            def availability(self) -> OCRProviderAvailability:
                return OCRProviderAvailability(
                    self.name,
                    False,
                    "Tesseract executable was not found.",
                )

        provider = UnavailableProvider(OCRRecognition("unused", 0.5))
        result = PageExtractionCoordinator(ocr_provider=provider).extract_page(
            b"image",
            mime_type="image/png",
            page_number=1,
            digital_text=None,
        )

        self.assertEqual(result.status, PageExtractionStatus.UNAVAILABLE)
        self.assertEqual(result.provider_name, "fake-local-ocr")
        self.assertIn("Tesseract executable was not found", result.error or "")
        self.assertEqual(provider.calls, [])

    def test_ocr_success_preserves_text_confidence_and_page_provenance(self) -> None:
        provider = FakeOCRProvider(OCRRecognition("OCR page text", 0.937))
        result = PageExtractionCoordinator(ocr_provider=provider).extract_page(
            b"scan",
            mime_type="application/pdf",
            page_number=7,
            digital_text="",
        )

        self.assertEqual(result.page_number, 7)
        self.assertEqual(result.text, "OCR page text")
        self.assertEqual(result.confidence, 0.937)
        self.assertEqual(result.extraction_method, ExtractionMethod.OCR)
        self.assertEqual(result.status, PageExtractionStatus.EXTRACTED)
        self.assertEqual(result.provider_name, "fake-local-ocr")
        self.assertEqual(provider.calls[0][2], result.page_number)

    def test_ocr_failure_is_returned_without_fabricated_text(self) -> None:
        provider = FakeOCRProvider(RuntimeError("rendering failed"))
        result = PageExtractionCoordinator(ocr_provider=provider).extract_page(
            b"scan",
            mime_type="application/pdf",
            page_number=4,
            digital_text=None,
        )

        self.assertEqual(result.page_number, 4)
        self.assertEqual(result.text, "")
        self.assertEqual(result.confidence, None)
        self.assertEqual(result.extraction_method, ExtractionMethod.UNAVAILABLE)
        self.assertEqual(result.status, PageExtractionStatus.FAILED)
        self.assertTrue(result.ocr_required)
        self.assertIn("rendering failed", result.error or "")

    def test_empty_ocr_output_is_a_failure(self) -> None:
        provider = FakeOCRProvider(OCRRecognition("  \n", 0.4))
        result = PageExtractionCoordinator(ocr_provider=provider).extract_page(
            b"scan",
            mime_type="image/jpeg",
            page_number=5,
            digital_text=None,
        )

        self.assertEqual(result.status, PageExtractionStatus.FAILED)
        self.assertEqual(result.text, "")
        self.assertIsNone(result.confidence)
        self.assertIn("returned no text", result.error or "")


if __name__ == "__main__":
    unittest.main()
