"""Page-wise digital PDF text extraction with an optional pypdf adapter.

When pypdf is not installed, a deliberately limited standard-library reader
handles uncompressed text streams in simple PDFs. It does not claim support for
encrypted, compressed, or otherwise complex PDFs; production deployments should
install pypdf through their normal dependency management.
"""

from __future__ import annotations

import importlib.util
import re
import zlib


class PDFExtractionError(ValueError):
    """The PDF is malformed or cannot be read by an available local parser."""


def pypdf_available() -> bool:
    return importlib.util.find_spec("pypdf") is not None


def extract_pdf_pages(data: bytes) -> list[str]:
    if pypdf_available():
        try:
            from io import BytesIO
            from pypdf import PdfReader

            reader = PdfReader(BytesIO(data), strict=False)
            return [(page.extract_text() or "").strip() for page in reader.pages]
        except Exception as exc:
            raise PDFExtractionError(f"PDF text extraction failed: {exc}") from exc
    return _extract_simple_pdf_pages(data)


def _extract_simple_pdf_pages(data: bytes) -> list[str]:
    try:
        source = data.decode("latin-1")
    except Exception as exc:  # pragma: no cover - latin-1 decodes every byte sequence
        raise PDFExtractionError("PDF content could not be decoded.") from exc

    objects = {
        int(match.group(1)): match.group(2)
        for match in re.finditer(r"(?s)(\d+)\s+\d+\s+obj\b(.*?)endobj", source)
    }
    pages: list[tuple[int, int]] = []
    for object_id, body in objects.items():
        if re.search(r"/Type\s*/Page\b", body):
            contents = re.search(r"/Contents\s+(\d+)\s+\d+\s+R", body)
            if contents:
                pages.append((object_id, int(contents.group(1))))
    pages.sort()
    if not pages:
        raise PDFExtractionError("No readable PDF page objects were found.")

    output: list[str] = []
    for _, content_id in pages:
        body = objects.get(content_id)
        if body is None:
            raise PDFExtractionError("A PDF page refers to a missing content stream.")
        stream_match = re.search(r"(?s)stream\r?\n(.*?)\r?\nendstream", body)
        if not stream_match:
            raise PDFExtractionError("A PDF page has no readable content stream.")
        stream = stream_match.group(1).encode("latin-1")
        if "/FlateDecode" in body:
            try:
                stream = zlib.decompress(stream)
            except zlib.error as exc:
                raise PDFExtractionError("A PDF content stream is compressed and unreadable.") from exc
        output.append(_text_from_pdf_operators(stream.decode("latin-1", errors="replace")))
    return output


def _text_from_pdf_operators(content: str) -> str:
    # Collect strings used with Tj and TJ operators, in display order.
    tokens = re.finditer(
        r"(?P<single>\((?:\\.|[^\\)])*\)\s*Tj)|\[(?P<array>.*?)\]\s*TJ",
        content,
        re.S,
    )
    pieces: list[str] = []
    for match in tokens:
        if match.group("single"):
            literal = re.match(r"\(((?:\\.|[^\\)])*)\)", match.group("single"))
            if literal:
                pieces.append(_decode_pdf_literal(literal.group(1)))
        else:
            for literal in re.findall(r"\(((?:\\.|[^\\)])*)\)", match.group("array") or ""):
                pieces.append(_decode_pdf_literal(literal))
    return " ".join(piece for piece in pieces if piece).strip()


def _decode_pdf_literal(value: str) -> str:
    value = re.sub(r"\\([()\\])", r"\1", value)
    value = re.sub(r"\\([nrtbf])", lambda match: {"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f"}[match.group(1)], value)
    value = re.sub(r"\\([0-7]{1,3})", lambda match: chr(int(match.group(1), 8)), value)
    value = re.sub(r"\\\r?\n", "", value)
    return value
