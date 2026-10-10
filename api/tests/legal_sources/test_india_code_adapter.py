from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
import json
import unittest

from app.engines.legal_sources.india_code import (
    API_BASE_URL,
    IndiaCodeApiAdapter,
    IndiaCodeApiError,
    official_url,
)
from app.routes import legal_sources


class _Response:
    def __init__(self, payload: object) -> None:
        self.body = BytesIO(json.dumps(payload).encode("utf-8"))

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self, size: int = -1) -> bytes:
        return self.body.read(size)


class IndiaCodeAdapterTests(unittest.TestCase):
    def test_official_url_allowlist_includes_india_code_migration_redirect_only(self) -> None:
        self.assertEqual(
            official_url("https://www.indiacode.nic.in/indiacode/handle/123"),
            "https://www.indiacode.nic.in/indiacode/handle/123",
        )
        self.assertIsNone(official_url("https://indiacode.ecourtsindia.com/api/v1/acts"))

    def test_search_uses_third_party_provenance_and_caches_original_fetch_time(self) -> None:
        calls: list[str] = []

        def opener(request, *, timeout):
            calls.append(request.full_url)
            self.assertEqual(timeout, 3)
            return _Response({"total": 1, "count": 1, "results": [{
                "kind": "section",
                "ref": "Section 2(10)",
                "title": "Consumer Protection Act, 2019",
                "snippet": "A defect includes a fault...",
                "url": "https://indiacode.ecourtsindia.com/api/v1/example/section/2(10)",
            }]})

        adapter = IndiaCodeApiAdapter(timeout_seconds=3, opener=opener)
        first = adapter.search(" defective goods ", limit=7)
        second = adapter.search("defective goods", limit=7)

        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0].startswith(f"{API_BASE_URL}/search?"))
        self.assertEqual(first.retrieved_at, second.retrieved_at)
        self.assertEqual(first.verification_status, "unverified")
        self.assertEqual(first.payload["results"][0]["ref"], "Section 2(10)")

    def test_provision_path_keeps_string_number_and_rejects_path_injection(self) -> None:
        calls: list[str] = []

        def opener(request, *, timeout):
            calls.append(request.full_url)
            return _Response({"act": {"jurisdiction": "STATE"}, "section": {"number": "1(2)(a)", "text": "Actual provision text"}})

        adapter = IndiaCodeApiAdapter(opener=opener)
        result = adapter.provision("consumer-act", "section", "1(2)(a)")

        self.assertEqual(result.payload["section"]["number"], "1(2)(a)")
        self.assertIn("/consumer-act/section/1%282%29%28a%29", calls[0])
        with self.assertRaises(ValueError):
            adapter.provision("../other", "section", "1")

    def test_adapter_rejects_oversized_or_non_json_responses(self) -> None:
        adapter = IndiaCodeApiAdapter(max_response_bytes=30, opener=lambda *args, **kwargs: _Response({"message": "x" * 40}))
        with self.assertRaisesRegex(IndiaCodeApiError, "size limit"):
            adapter.acts()

        class _BadJsonResponse(_Response):
            def __init__(self) -> None:
                self.body = BytesIO(b"not json")

        bad = IndiaCodeApiAdapter(opener=lambda *args, **kwargs: _BadJsonResponse())
        with self.assertRaisesRegex(IndiaCodeApiError, "invalid JSON"):
            bad.acts()

    def test_search_route_keeps_snippets_discovery_only_and_state_scope_explicit(self) -> None:
        class _Adapter:
            def search(self, query: str, *, limit: int):
                class _Result:
                    endpoint = f"{API_BASE_URL}/search?q={query}&limit={limit}"
                    retrieved_at = datetime(2026, 10, 10, tzinfo=timezone.utc)
                    provider_name = "IndiaCode/eCourtsIndia (third-party API)"
                    verification_note = "API responses are unverified."
                    official_verification_portals = ("https://www.indiacode.gov.in/", "https://egazette.gov.in/")
                    payload = {"total": 1, "count": 1, "results": [{
                        "kind": "section", "ref": "Section 1", "title": "Example Act",
                        "snippet": "search fragment", "jurisdiction": "STATE",
                        "url": "https://indiacode.ecourtsindia.com/reference/act/1",
                    }]}
                return _Result()

        old_adapter = legal_sources._adapter
        legal_sources._adapter = _Adapter()
        try:
            response = legal_sources.search_india_code(q="example", limit=5)
        finally:
            legal_sources._adapter = old_adapter

        hit = response.results[0]
        self.assertEqual(hit.jurisdiction_scope, "state_or_ut")
        self.assertEqual(hit.result_use, "discovery_only")
        self.assertEqual(hit.text_status, "snippet_is_not_full_provision_text")
        self.assertIsNone(hit.official_source_url)
        self.assertEqual(response.source.verification_status, "unverified")

    def test_acts_route_bounds_list_and_keeps_provider_status_unverified(self) -> None:
        class _Adapter:
            def acts(self):
                class _Result:
                    endpoint = f"{API_BASE_URL}/acts"
                    retrieved_at = datetime(2026, 10, 10, tzinfo=timezone.utc)
                    provider_name = "IndiaCode/eCourtsIndia (third-party API)"
                    verification_note = "Check the Gazette."
                    official_verification_portals = ("https://indiacode.gov.in/", "https://egazette.gov.in/")
                    payload = {"acts": [
                        {"id": "act-one", "title": "Act One", "jurisdiction": "CENTRAL"},
                        {"id": "act-two", "title": "Act Two", "jurisdiction": "STATE"},
                    ]}
                return _Result()

        old_adapter = legal_sources._adapter
        legal_sources._adapter = _Adapter()
        try:
            response = legal_sources.list_india_code_acts(limit=1)
        finally:
            legal_sources._adapter = old_adapter

        self.assertEqual(response.returned_count, 1)
        self.assertTrue(response.truncated)
        self.assertEqual(response.acts[0].jurisdiction_scope, "central")
        self.assertEqual(response.acts[0].verification_status, "unverified")

    def test_exact_provision_route_returns_full_text_and_third_party_provenance(self) -> None:
        class _Adapter:
            def provision(self, act_id: str, unit: str, number: str):
                self_args = (act_id, unit, number)
                assert self_args == ("act-one", "section", "17(2)")

                class _Result:
                    endpoint = f"{API_BASE_URL}/act-one/section/17%282%29"
                    retrieved_at = datetime(2026, 10, 10, tzinfo=timezone.utc)
                    provider_name = "IndiaCode/eCourtsIndia (third-party API)"
                    verification_note = "API copy is unverified."
                    official_verification_portals = ("https://indiacode.gov.in/", "https://egazette.gov.in/")
                    payload = {
                        "act": {"title": "Example Act", "jurisdiction": "CENTRAL"},
                        "section": {"number": "17(2)", "heading": "Payment", "text": "Full served section text."},
                        "url": "https://indiacode.ecourtsindia.com/api/v1/act-one/section/17%282%29",
                    }
                return _Result()

        old_adapter = legal_sources._adapter
        legal_sources._adapter = _Adapter()
        try:
            response = legal_sources.read_india_code_provision("act-one", "section", "17(2)")
        finally:
            legal_sources._adapter = old_adapter

        self.assertEqual(response.provision_text, "Full served section text.")
        self.assertEqual(response.provision_number, "17(2)")
        self.assertEqual(response.jurisdiction_scope, "central")
        self.assertEqual(response.verification_status, "unverified")
        self.assertIsNone(response.official_source_url)
        self.assertIn("third-party API", response.source.provider)


if __name__ == "__main__":
    unittest.main()
