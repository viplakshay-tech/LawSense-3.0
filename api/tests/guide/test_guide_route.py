from __future__ import annotations

import asyncio
import json
import unittest
from io import BytesIO
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler
from unittest.mock import patch

from app.main import app
from app.services import local_assistant


class _Response:
    def __init__(self, payload: object) -> None:
        self.body = BytesIO(json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self, size: int = -1) -> bytes:
        return self.body.read(size)


class _MockOpener:
    def __init__(self, callback) -> None:
        self.callback = callback

    def open(self, request, *, timeout):
        return self.callback(request, timeout=timeout)


def _asgi_request(payload: dict[str, object]) -> tuple[int, object]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    sent_request = False
    status = 500
    chunks: list[bytes] = []

    async def receive() -> dict[str, object]:
        nonlocal sent_request
        if sent_request:
            return {"type": "http.disconnect"}
        sent_request = True
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message: dict[str, object]) -> None:
        nonlocal status
        if message["type"] == "http.response.start":
            status = int(message["status"])
        elif message["type"] == "http.response.body":
            chunks.append(message.get("body", b""))  # type: ignore[arg-type]

    path = "/guide/chat"
    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": b"",
        "root_path": "",
        "headers": [(b"host", b"testserver"), (b"content-type", b"application/json")],
        "client": ("testclient", 123),
        "server": ("testserver", 80),
        "state": {},
    }
    asyncio.run(app(scope, receive, send))
    response = b"".join(chunks)
    return status, json.loads(response) if response else None


class GuideRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.payload = {
            "message": "Iska simple matlab kya hai?",
            "language": "hinglish",
            "verified_material": [{"title": "Supplied material", "text": "A verified plain-language description."}],
            "case_context": {
                "case_title": "Housing deposit dispute",
                "initial_statement": "My landlord has not returned the deposit.",
                "jurisdiction": "India, Uttarakhand",
                "jurisdiction_basis": "user_reported",
                "facts": [{
                    "key": "deposit amount",
                    "value": "30000 INR",
                    "status": "user_reported",
                    "confidence": "medium",
                }],
                "open_questions": ["Was there a written rental agreement?"],
                "assumptions": [],
                "conflicts": [],
                "evidence": [],
                "document_count": 0,
                "legal_issue_categories": ["housing"],
                "legal_knowledge_status": "records_found",
                "legal_sources": [{
                    "title": "Rental deposit provision",
                    "record_type": "legal_provision",
                    "status": "verified",
                    "jurisdiction": "Uttarakhand",
                    "verification_status": "verified",
                    "freshness_status": "unknown",
                    "applicability_status": "unknown",
                }],
                "safety_context": "none",
                "safety_urgency": "none",
            },
        }

    def _proxy_free_opener_patch(self, callback):
        def build_opener(*handlers):
            proxy_handlers = [handler for handler in handlers if isinstance(handler, ProxyHandler)]
            self.assertEqual(len(proxy_handlers), 1)
            self.assertEqual(proxy_handlers[0].proxies, {})
            return _MockOpener(callback)

        return patch.object(local_assistant, "build_opener", side_effect=build_opener)

    def test_guide_uses_only_local_ollama_chat_and_hides_reasoning_fields(self) -> None:
        def opener(request, *, timeout):
            self.assertEqual(request.full_url, "http://127.0.0.1:11434/api/chat")
            self.assertEqual(timeout, local_assistant.OLLAMA_TIMEOUT_SECONDS)
            sent = json.loads(request.data.decode("utf-8"))
            self.assertEqual(sent["model"], "test-local-model")
            self.assertIs(sent["think"], False)
            self.assertIs(sent["stream"], False)
            self.assertEqual(sent["messages"][1]["content"].splitlines()[0], "Requested reply language: hinglish")
            self.assertIn("Supplied material", sent["messages"][1]["content"])
            self.assertIn("Current LawSense case snapshot", sent["messages"][1]["content"])
            self.assertIn("Housing deposit dispute", sent["messages"][1]["content"])
            self.assertIn("user_reported", sent["messages"][1]["content"])
            self.assertIn("The case snapshot is context, not proof or legal authority.", sent["messages"][0]["content"])
            self.assertIn("Never decide whether a law applies", sent["messages"][0]["content"])
            return _Response({"message": {
                "content": "Simple explanation. <think>hidden reasoning</think> Follow-up?",
                "thinking": "separate hidden reasoning",
            }})

        with patch.dict("os.environ", {
            "OLLAMA_MODEL": "test-local-model",
            "HTTP_PROXY": "http://proxy.example:8080",
            "HTTPS_PROXY": "http://proxy.example:8080",
            "ALL_PROXY": "http://proxy.example:8080",
        }, clear=False):
            with self._proxy_free_opener_patch(opener) as mocked_builder:
                status, response = _asgi_request(self.payload)

        self.assertEqual(status, 200)
        self.assertEqual(response, {
            "reply": "Simple explanation.  Follow-up?",
            "status": "ok",
            "model": "test-local-model",
        })
        mocked_builder.assert_called_once()

    def test_defaults_are_loopback_and_use_the_configured_qwen_model_name(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(local_assistant._local_chat_url(), "http://127.0.0.1:11434/api/chat")
            self.assertEqual(local_assistant._configured_model(), "qwen3.5:4b-q4_K_M")

    def test_missing_model_returns_a_graceful_unavailable_response(self) -> None:
        def missing_model(request, *, timeout):
            raise HTTPError(request.full_url, 404, "model not found", {}, BytesIO(b"private server detail"))

        with self._proxy_free_opener_patch(missing_model):
            status, response = _asgi_request(self.payload)

        self.assertEqual(status, 200)
        self.assertEqual(response["status"], "unavailable")
        self.assertIn("is not available", response["reply"])
        self.assertNotIn("private server detail", response["reply"])

    def test_unreachable_ollama_returns_helpful_response_without_failing_the_api(self) -> None:
        def unreachable(request, *, timeout):
            raise URLError("connection refused")

        with self._proxy_free_opener_patch(unreachable):
            status, response = _asgi_request(self.payload)

        self.assertEqual(status, 200)
        self.assertEqual(response["status"], "unavailable")
        self.assertIn("Make sure Ollama is running", response["reply"])

    def test_ollama_timeout_returns_helpful_unavailable_response(self) -> None:
        def timed_out(request, *, timeout):
            raise TimeoutError("local inference timed out")

        with self._proxy_free_opener_patch(timed_out):
            status, response = _asgi_request(self.payload)

        self.assertEqual(status, 200)
        self.assertEqual(response["status"], "unavailable")
        self.assertIn("could not reach Ollama", response["reply"])
        self.assertIn("Make sure Ollama is running", response["reply"])

    def test_non_loopback_base_url_is_rejected_before_sending_case_text(self) -> None:
        with (
            patch.dict("os.environ", {"OLLAMA_BASE_URL": "https://example.com"}, clear=False),
            self._proxy_free_opener_patch(lambda *args, **kwargs: None) as mocked_builder,
        ):
            status, response = _asgi_request(self.payload)

        self.assertEqual(status, 200)
        self.assertEqual(response["status"], "unavailable")
        mocked_builder.assert_not_called()

    def test_request_and_response_sizes_are_validated(self) -> None:
        with self._proxy_free_opener_patch(lambda *args, **kwargs: None) as mocked_builder:
            blank_status, blank_response = _asgi_request({"message": "   "})
            material_status, material_response = _asgi_request({
                "message": "Explain this",
                "verified_material": [{"title": "x", "text": "y" * 20_000}],
            })

        oversized_context_status, oversized_context_response = _asgi_request({
            "message": "Help me understand my case",
            "case_context": {"initial_statement": "x" * 2_001},
        })

        self.assertEqual(blank_status, 422, blank_response)
        self.assertEqual(material_status, 422, material_response)
        self.assertEqual(oversized_context_status, 422, oversized_context_response)
        mocked_builder.assert_not_called()

        with self._proxy_free_opener_patch(lambda *args, **kwargs: _Response({"message": {"content": "x" * 6_001}})):
            oversized_status, oversized_response = _asgi_request(self.payload)
        self.assertEqual(oversized_status, 200)
        self.assertEqual(oversized_response["status"], "unavailable")
        self.assertLessEqual(len(oversized_response["reply"]), 6_000)


if __name__ == "__main__":
    unittest.main()
