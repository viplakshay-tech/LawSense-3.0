from __future__ import annotations

import io
import unittest
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

from PIL import Image

from app.engines.document_intelligence import DocumentProcessingStatus, process_document
from app.engines.document_intelligence.ocr_settings import OCRSettings
from app.engines.document_intelligence.tesseract_provider import TesseractOCRProvider
from document_intelligence.test_pipeline import make_pdf


_TSV = (
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
    "5\t1\t1\t1\t1\t1\t10\t20\t50\t10\t94.00\tRecognized\n"
    "5\t1\t1\t1\t1\t2\t65\t20\t40\t10\t88.00\twords\n"
    "5\t1\t1\t1\t2\t1\t10\t40\t40\t10\t99.00\tverified\n"
)


class TesseractProviderTests(unittest.TestCase):
    def png_bytes(self) -> bytes:
        image = Image.new("RGB", (160, 80), color="white")
        output = io.BytesIO()
        image.save(output, format="PNG")
        return output.getvalue()

    def mocked_tesseract_run(self, args: list[str], **kwargs: object) -> CompletedProcess[str]:
        if len(args) > 1 and args[1] == "--version":
            return CompletedProcess(args, 0, stdout="tesseract 5.5.0", stderr="")
        if len(args) > 1 and args[1] == "--list-langs":
            return CompletedProcess(args, 0, stdout="List of available languages in test:\neng\nhin\n", stderr="")
        image_path = Path(args[1])
        self.assertTrue(image_path.is_file())
        with Image.open(image_path) as image:
            self.assertGreater(image.width, 0)
            self.assertGreater(image.height, 0)
        return CompletedProcess(args, 0, stdout=_TSV, stderr="")

    def test_image_ocr_uses_tesseract_tsv_words_and_confidence(self) -> None:
        provider = TesseractOCRProvider(OCRSettings(tesseract_command="tesseract-test.exe"))
        with (
            patch("app.engines.document_intelligence.tesseract_provider.shutil.which", return_value="C:/fake/tesseract.exe"),
            patch(
                "app.engines.document_intelligence.tesseract_provider.subprocess.run",
                side_effect=self.mocked_tesseract_run,
            ) as run,
        ):
            result = process_document(self.png_bytes(), "scan.png", ocr_provider=provider)

        self.assertEqual(result.status, DocumentProcessingStatus.EXTRACTED)
        self.assertEqual(result.pages[0].text, "Recognized words\nverified")
        self.assertAlmostEqual(result.pages[0].confidence or 0, (94 + 88 + 99) / 300)
        self.assertEqual(result.pages[0].provider_name, "tesseract")
        self.assertEqual(run.call_count, 3)  # version, language data, and one OCR pass

    def test_missing_language_data_makes_provider_unavailable(self) -> None:
        provider = TesseractOCRProvider(
            OCRSettings(tesseract_command="tesseract-test.exe", language="hin")
        )

        def only_english(args: list[str], **kwargs: object) -> CompletedProcess[str]:
            if args[1] == "--version":
                return CompletedProcess(args, 0, stdout="tesseract 5.5.0", stderr="")
            return CompletedProcess(args, 0, stdout="List of available languages in test:\neng\n", stderr="")

        with (
            patch("app.engines.document_intelligence.tesseract_provider.shutil.which", return_value="C:/fake/tesseract.exe"),
            patch(
                "app.engines.document_intelligence.tesseract_provider.subprocess.run",
                side_effect=only_english,
            ) as run,
        ):
            availability = provider.availability

        self.assertFalse(availability.available)
        self.assertIn("hin", availability.reason or "")
        self.assertEqual(run.call_count, 2)

    def test_scanned_pdf_page_is_rendered_and_ocr_provenance_survives_pipeline(self) -> None:
        provider = TesseractOCRProvider(OCRSettings(tesseract_command="tesseract-test.exe"))
        pdf = make_pdf(["Digitally readable page", ""])
        with (
            patch("app.engines.document_intelligence.tesseract_provider.shutil.which", return_value="C:/fake/tesseract.exe"),
            patch(
                "app.engines.document_intelligence.tesseract_provider.subprocess.run",
                side_effect=self.mocked_tesseract_run,
            ) as run,
        ):
            result = process_document(pdf, "mixed-scan.pdf", ocr_provider=provider)

        self.assertEqual(result.status, DocumentProcessingStatus.EXTRACTED)
        self.assertEqual([page.page_number for page in result.pages], [1, 2])
        self.assertEqual(result.pages[0].text, "Digitally readable page")
        self.assertIn(result.pages[0].extraction_method, {"pypdf", "simple_pdf"})
        self.assertEqual(result.pages[1].text, "Recognized words\nverified")
        self.assertEqual(result.pages[1].extraction_method, "ocr")
        self.assertAlmostEqual(result.pages[1].confidence or 0, (94 + 88 + 99) / 300)
        self.assertEqual(result.pages[1].provider_name, "tesseract")
        self.assertEqual(run.call_count, 3)  # digital page bypassed OCR


if __name__ == "__main__":
    unittest.main()
