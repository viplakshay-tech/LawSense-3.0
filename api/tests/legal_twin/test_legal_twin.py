from __future__ import annotations

import unittest
from dataclasses import replace

from app.schemas.case_state import (
    CaseClaim,
    CaseDocument,
    CaseDocumentPage,
    CaseEvent,
    CaseFact,
    CaseMetadata,
    CasePerson,
    CaseState,
    EvidenceItem,
    EvidenceProvenance,
    LegalIssue,
    Party,
)
from app.schemas.case_analysis import (
    CaseAnalysis,
    DecisionScenarioSummary,
    JourneySummary,
    LegalKnowledgeProvenance,
    LegalKnowledgeRecordSummary,
    LegalKnowledgeSummary,
    SafetyContextSummary,
    SimulatorPathStepSummary,
    SimulatorPathSummary,
    SimulatorRequirementSummary,
)
from app.engines.legal_twin import (
    EdgeType,
    InformationStatus,
    LegalTwin,
    NodeType,
    TimelineSnapshot,
    TimelineEvent,
    TwinEdge,
    TwinNode,
    TwinProvenance,
    build_legal_twin,
    compare_snapshots,
    generate_timeline,
    snapshot_at,
    unresolved_nodes,
)
from app.services.legal_twin_service import (
    build_case_twin,
    build_case_twin_delta,
    compare_case_twin_states,
)


def make_case_state() -> CaseState:
    return CaseState(
        id="case-twin-1",
        title="Recorded dispute",
        person=CasePerson(name="Asha", contact="asha@example.test"),
        parties=[Party(id="p1", name="Ravi", role="landlord", relationship="property owner")],
        facts=[
            CaseFact(
                id="f1",
                key="amount_inr",
                value=30000,
                status="evidence_supported",
                confidence="high",
                sourceIds=["statement"],
                provenance=[EvidenceProvenance(
                    documentId="doc1",
                    pageNumber=1,
                    confidence=0.95,
                    status="evidence_supported",
                    extractionMethod="pdf_text",
                )],
            ),
        ],
        events=[
            CaseEvent(
                id="ev1", type="payment", description="A deposit was recorded.",
                date="2025-01-10", datePrecision="exact", partyIds=["p1"], evidenceIds=["statement"],
            ),
            CaseEvent(
                id="ev2", type="request", description="A return was requested.",
                date="2026-01-10", datePrecision="exact", partyIds=["p1"], evidenceIds=["statement"],
            ),
            CaseEvent(
                id="ev3", type="response", description="An approximate response date is recorded.",
                date="2025-03-01", datePrecision="approximate", partyIds=[], evidenceIds=[],
            ),
        ],
        evidence=[
            EvidenceItem(
                id="statement", type="message", title="User account", source="user",
                status="user_reported", supportsClaimIds=["c1"], conflictsWithClaimIds=["c2"],
            ),
            EvidenceItem(
                id="document-evidence", type="receipt", title="Payment receipt", source="document",
                status="evidence_supported", documentId="doc1", supportsClaimIds=["c2"],
            ),
        ],
        documents=[
            CaseDocument(
                id="doc1", filename="receipt.pdf", mimeType="application/pdf", extension=".pdf",
                fileSize=500, sha256="a" * 64, pageCount=1,
                processingTimestamp="2025-02-01T09:30:00+00:00", processingStatus="extracted",
                classification="receipt", classificationConfidence=0.9,
                pages=[CaseDocumentPage(pageNumber=1, extractionMethod="pdf_text", processingStatus="extracted", textLength=25)],
            ),
        ],
        claims=[
            CaseClaim(id="c1", text="The deposit was paid.", status="user_reported", evidenceIds=["statement"]),
            CaseClaim(id="c2", text="The receipt records a payment.", status="conflicting", evidenceIds=["document-evidence"]),
        ],
        legalIssues=[LegalIssue(id="issue1", category="housing", subcategory="deposit", confidence="medium", rationale=["Recorded category."])],
        unknowns=["The move-out date is not recorded."],
        metadata=CaseMetadata(createdAt="2024-12-01T00:00:00+00:00", updatedAt="2026-01-11T00:00:00+00:00"),
    )


class BuildLegalTwinTests(unittest.TestCase):
    def test_builder_maps_records_with_source_status_and_provenance(self) -> None:
        twin = build_legal_twin(make_case_state())

        self.assertEqual(twin.case_id, "case-twin-1")
        self.assertEqual(twin.nodes["claim:fact:f1"].kind, NodeType.FACT)
        self.assertEqual(twin.nodes["claim:fact:f1"].status, "evidence_supported")
        fact_provenance = twin.nodes["claim:fact:f1"].provenance[0]
        self.assertEqual((fact_provenance.source_id, fact_provenance.page_number), ("doc1", 1))
        self.assertEqual(twin.nodes["evidence:statement"].status, "user_reported")
        self.assertEqual(twin.nodes["event:ev1"].kind, NodeType.EVENT)
        self.assertEqual(twin.nodes["document:doc1"].kind, NodeType.DOCUMENT)
        self.assertEqual(twin.nodes["party:p1"].properties["role"], "landlord")
        self.assertEqual(twin.nodes["legal_issue:issue1"].status, "system_inferred")
        self.assertEqual(twin.nodes["person:case-twin-1"].status, "unknown")
        self.assertTrue(all(node.provenance for node in twin.nodes.values()))
        self.assertIn("jurisdiction", twin.context)
        self.assertIn("claim:unknown:", next(
            node.id for node in twin.nodes.values() if node.properties.get("record_type") == "unknown"
        ))

    def test_builder_creates_only_recorded_relationships(self) -> None:
        twin = build_legal_twin(make_case_state())
        relations = {(edge.source_id, edge.target_id, edge.kind) for edge in twin.edges.values()}

        self.assertIn(("event:ev1", "party:p1", EdgeType.INVOLVES), relations)
        self.assertIn(("event:ev1", "evidence:statement", EdgeType.REFERENCES), relations)
        self.assertIn(("evidence:statement", "claim:c1", EdgeType.SUPPORTS), relations)
        self.assertIn(("evidence:statement", "claim:c2", EdgeType.CONTRADICTS), relations)
        self.assertIn(("evidence:document-evidence", "document:doc1", EdgeType.REFERENCES), relations)
        self.assertFalse(any(node.kind in {NodeType.PROCEDURE, NodeType.AUTHORITY} for node in twin.nodes.values()))

    def test_build_is_deterministic_and_node_properties_are_read_only(self) -> None:
        state = make_case_state()
        first, second = build_legal_twin(state), build_legal_twin(state)

        self.assertEqual(first.nodes, second.nodes)
        self.assertEqual(first.edges, second.edges)
        with self.assertRaises(TypeError):
            first.nodes["event:ev1"].properties["event_type"] = "changed"


class TimelineAndSnapshotTests(unittest.TestCase):
    def setUp(self) -> None:
        self.twin = build_legal_twin(make_case_state())

    def test_timeline_is_chronological_and_keeps_date_precision(self) -> None:
        timeline = generate_timeline(self.twin)

        case_event_order = [item.id for item in timeline if item.id in {"ev1", "ev2", "ev3"}]
        self.assertEqual(case_event_order, ["ev1", "ev3", "ev2"])
        self.assertEqual(next(item for item in timeline if item.id == "ev3").date_precision, "approximate")
        self.assertTrue(any(item.kind == "document_recorded" for item in timeline))
        self.assertEqual(timeline, self.twin.generate_timeline())

    def test_snapshot_at_filters_future_events_and_records_and_dangling_edges(self) -> None:
        snapshot = snapshot_at(self.twin, "2025-01-15T00:00:00Z")
        node_ids = {node.id for node in snapshot.nodes}
        edge_endpoints = {(edge.source_id, edge.target_id) for edge in snapshot.edges}

        self.assertIn("event:ev1", node_ids)
        self.assertNotIn("event:ev2", node_ids)
        self.assertNotIn("claim:fact:f1", node_ids)
        self.assertNotIn("document:doc1", node_ids)
        self.assertNotIn("evidence:document-evidence", node_ids)
        self.assertNotIn("claim:c2", node_ids)
        self.assertTrue(all(left in node_ids and right in node_ids for left, right in edge_endpoints))
        self.assertTrue(any(item.id == "ev1" for item in snapshot.timeline))
        self.assertFalse(any(item.id == "ev2" for item in snapshot.timeline))
        self.assertIn("event:ev3", snapshot.temporally_uncertain_node_ids)
        self.assertTrue(snapshot.limitations)
        self.assertNotIn("jurisdiction", snapshot.context)
        self.assertIn("title", snapshot.context)
        self.assertIn("2025-01-15", snapshot.as_of.isoformat())

    def test_exact_date_value_filters_future_event_without_occurred_at(self) -> None:
        provenance = (TwinProvenance(
            source_id="statement",
            source_type="user",
            source_path="events/future",
            status="user_reported",
        ),)
        node = TwinNode(
            id="event:future",
            kind=NodeType.EVENT,
            label="Future event",
            status="user_reported",
            properties={"date_precision": "exact", "date_value": "2030-01-02"},
            provenance=provenance,
        )
        event = TimelineEvent(
            id="future",
            kind="reported_event",
            summary="Future event",
            occurred_at=None,
            date_value="2030-01-02",
            date_precision="exact",
            related_node_ids=(node.id,),
            status="user_reported",
            provenance=provenance,
        )
        twin = LegalTwin(case_id="future-case", nodes={node.id: node}, timeline=(event,))

        historical = snapshot_at(twin, "2029-12-31T23:59:59Z")
        current = snapshot_at(twin, "2030-01-02T00:00:00Z")

        self.assertNotIn(node.id, {item.id for item in historical.nodes})
        self.assertNotIn(event.id, {item.id for item in historical.timeline})
        self.assertIn(node.id, {item.id for item in current.nodes})
        self.assertIn(event.id, {item.id for item in current.timeline})

    def test_snapshot_does_not_mutate_twin_and_keeps_unknown_status_visible(self) -> None:
        original_nodes = dict(self.twin.nodes)
        snapshot = self.twin.snapshot_at("2026-02-01")

        self.assertEqual(original_nodes, self.twin.nodes)
        self.assertIn("person:case-twin-1", {node.id for node in snapshot.nodes})
        self.assertIn("person:case-twin-1", snapshot.unresolved_node_ids)

    def test_unresolved_nodes_are_status_based_and_stably_ordered(self) -> None:
        unresolved = unresolved_nodes(self.twin)
        unresolved_ids = [node.id for node in unresolved]

        self.assertEqual(unresolved_ids, sorted(unresolved_ids))
        self.assertIn("person:case-twin-1", unresolved_ids)
        self.assertIn("claim:c2", unresolved_ids)
        self.assertNotIn("evidence:statement", unresolved_ids)

    def test_invalid_as_of_value_raises(self) -> None:
        with self.assertRaises(ValueError):
            snapshot_at(self.twin, "not a date")


class ComparisonAndGraphIntegrityTests(unittest.TestCase):
    def test_comparison_reports_added_removed_changed_nodes_and_edges(self) -> None:
        provenance = (TwinProvenance("source", "user", "claims/1", "user_reported"),)
        before_node = TwinNode("claim:1", NodeType.CLAIM, "Claim", "user_reported", provenance)
        after_node = replace(before_node, status="conflicting", properties={"note": "new source conflict"})
        retained = TwinNode("party:1", NodeType.PARTY, "Party", "unknown", provenance)
        extra = TwinNode("document:1", NodeType.DOCUMENT, "Doc", "evidence_supported", provenance)
        before_edge = TwinEdge("party:1", "claim:1", EdgeType.RELATES_TO, provenance=provenance)
        after_edge = replace(before_edge, status="conflicting")
        first = TimelineSnapshot("same", snapshot_at(build_legal_twin(make_case_state()), "2025-01-01").as_of,
                                 (before_node, retained), (before_edge,), ())
        second = TimelineSnapshot("same", snapshot_at(build_legal_twin(make_case_state()), "2026-01-01").as_of,
                                  (after_node, extra), (after_edge,), ())

        result = compare_snapshots(first, second)

        self.assertEqual([node.id for node in result.added_nodes], ["document:1"])
        self.assertEqual([node.id for node in result.removed_nodes], ["party:1"])
        self.assertEqual(result.changed_nodes[0].id, "claim:1")
        self.assertEqual(result.changed_edges[0].id, before_edge.id)
        self.assertFalse(result.added_edges)
        self.assertFalse(result.removed_edges)

    def test_comparison_reports_context_changes(self) -> None:
        first = TimelineSnapshot("same", snapshot_at(self._simple_twin("same"), "2025-01-01").as_of,
                                 (), (), (), context={"jurisdiction": {"state": "A"}})
        second = TimelineSnapshot("same", first.as_of, (), (), (), context={"jurisdiction": {"state": "B"}})

        result = compare_snapshots(first, second)

        self.assertEqual(len(result.changed_context), 1)
        self.assertEqual(result.changed_context[0].key, "jurisdiction")

    def test_comparison_rejects_different_cases(self) -> None:
        time = snapshot_at(self._simple_twin("a"), "2025-01-01")
        other = snapshot_at(self._simple_twin("b"), "2025-01-01")
        with self.assertRaises(ValueError):
            compare_snapshots(time, other)

    def test_graph_rejects_missing_endpoints_and_duplicate_id_conflicts(self) -> None:
        twin = LegalTwin("case")
        node = TwinNode("n1", NodeType.PERSON, "Person")
        twin.add_node(node)
        twin.add_node(node)
        with self.assertRaises(ValueError):
            twin.add_node(TwinNode("n1", NodeType.PERSON, "Different"))
        with self.assertRaises(ValueError):
            twin.add_edge(TwinEdge("n1", "missing", EdgeType.RELATES_TO))
        with self.assertRaises(ValueError):
            twin.add_node(TwinNode("n2", "NOT_A_NODE_TYPE", "Invalid"))  # type: ignore[arg-type]

    @staticmethod
    def _simple_twin(case_id: str) -> LegalTwin:
        twin = LegalTwin(case_id)
        twin.add_node(TwinNode("n", NodeType.PERSON, "Person"))
        return twin


class CaseStateProjectionChangeTests(unittest.TestCase):
    def test_added_evidence_changes_the_canonical_projection(self) -> None:
        before = make_case_state()
        after = before.model_copy(deep=True)
        after.evidence.append(EvidenceItem(
            id="new-evidence",
            type="message",
            title="Follow-up email",
            source="user",
            status="user_reported",
        ))
        after.metadata.updatedAt = "2026-01-12T00:00:00+00:00"

        before_projection = build_case_twin(before).snapshot
        after_projection = build_case_twin(after).snapshot
        delta = compare_case_twin_states(before, after)

        self.assertIn("evidence:new-evidence", {item.id for item in after_projection.nodes})
        self.assertNotIn("evidence:new-evidence", {item.id for item in before_projection.nodes})
        self.assertIn("evidence:new-evidence", delta.added_node_ids)

    def test_fact_confirmation_changes_its_projected_status_and_recorded_time(self) -> None:
        before = make_case_state()
        before.facts[0].status = "unknown"
        before.facts[0].provenance[0].status = "unknown"
        after = before.model_copy(deep=True)
        after.facts[0].status = "evidence_supported"
        after.facts[0].provenance[0].status = "evidence_supported"
        after.facts[0].provenance[0].confirmedByUser = True
        after.facts[0].provenance[0].confirmedAt = "2026-02-01T00:00:00+00:00"
        after.metadata.updatedAt = "2026-02-01T00:00:00+00:00"

        before_node = next(item for item in build_case_twin(before).snapshot.nodes if item.id == "claim:fact:f1")
        after_node = next(item for item in build_case_twin(after).snapshot.nodes if item.id == "claim:fact:f1")
        delta = compare_case_twin_states(before, after)

        self.assertEqual(before_node.kind, "FACT")
        self.assertEqual(before_node.status, "unknown")
        self.assertEqual(after_node.status, "evidence_supported")
        self.assertEqual(after_node.recorded_at.isoformat(), "2026-02-01T00:00:00+00:00")
        self.assertIn("claim:fact:f1", delta.changed_node_ids)

    def test_as_of_timeline_snapshot_changes_when_a_dated_event_occurs(self) -> None:
        case_state = make_case_state()
        before = build_case_twin_delta(
            case_state,
            from_as_of="2025-12-31T23:59:59Z",
            to_as_of="2026-01-15T00:00:00Z",
        )
        earlier = build_case_twin(case_state, as_of="2025-12-31T23:59:59Z").snapshot
        later = build_case_twin(case_state, as_of="2026-01-15T00:00:00Z").snapshot

        self.assertNotIn("event:ev2", {item.id for item in earlier.nodes})
        self.assertIn("event:ev2", {item.id for item in later.nodes})
        self.assertIn("event:ev2", before.added_node_ids)

    def test_document_change_propagates_to_dependent_action_and_readiness(self) -> None:
        before = make_case_state()
        before.analysis = _analysis_with_document_prerequisite("case-twin-1", "not_confirmed")
        after = before.model_copy(deep=True)
        after.documents[0].sha256 = "b" * 64
        after.analysis.decision_scenario.required_documents[0].availability = "recorded_in_case_state"
        after.metadata.updatedAt = "2026-02-01T00:00:00+00:00"

        delta = compare_case_twin_states(before, after)

        action_id = "action:path-step:organize-documents"
        self.assertIn("document:doc1", delta.changed_node_ids)
        self.assertIn("document:doc1", delta.impacted_document_ids)
        self.assertIn("claim:fact:f1", delta.impacted_node_ids)
        self.assertIn(action_id, delta.affected_action_ids)
        self.assertEqual(len(delta.action_readiness_changes), 1)
        self.assertEqual(delta.action_readiness_changes[0].before_status, "inputs_missing")
        self.assertEqual(delta.action_readiness_changes[0].after_status, "inputs_recorded")

    def test_provenance_survives_api_projection_for_nodes_and_edges(self) -> None:
        snapshot = build_case_twin(make_case_state()).snapshot
        fact = next(item for item in snapshot.nodes if item.id == "claim:fact:f1")
        support = next(
            item for item in snapshot.edges
            if item.source_id == "document:doc1" and item.target_id == "claim:fact:f1"
        )

        self.assertEqual(fact.provenance[0].source_id, "doc1")
        self.assertEqual(fact.provenance[0].page_number, 1)
        self.assertEqual(support.provenance[0].source_path, "documents/doc1/pages/1")

    def test_legal_provision_projects_as_a_law_node_with_source_provenance(self) -> None:
        state = make_case_state()
        analysis = _analysis_with_document_prerequisite(state.id, "recorded_in_case_state")
        analysis.legal_knowledge = LegalKnowledgeSummary(
            status="records_found",
            records=[LegalKnowledgeRecordSummary(
                id="provision-1",
                title="Security deposit provision",
                type="legal_provision",
                status="verified",
                reference="Section 4",
                provenance=[LegalKnowledgeProvenance(
                    source_id="official-source",
                    retrieval_time="2026-02-01T00:00:00+00:00",
                    provision_id="provision-1",
                    page_section_reference="Section 4",
                )],
            )],
        )
        state.analysis = analysis

        law = build_case_twin(state).snapshot.nodes
        node = next(item for item in law if item.id == "law:provision-1")

        self.assertEqual(node.kind, "LAW")
        self.assertEqual(node.provenance[0].source_id, "official-source")
        self.assertEqual(node.properties["provision"], "Section 4")


def _analysis_with_document_prerequisite(case_id: str, availability: str) -> CaseAnalysis:
    requirement = SimulatorRequirementSummary(
        id="doc1",
        document="Payment receipt",
        purpose="Organize the recorded receipt.",
        availability=availability,
    )
    step = SimulatorPathStepSummary(
        id="organize-documents",
        action="Organize the recorded documents.",
        reason="Preparation step.",
        status="information_only",
        related_requirement_ids=["doc1"],
    )
    path = SimulatorPathSummary(
        id="path1",
        label="Candidate path",
        description="Verification required.",
        status="verification_required",
        steps=[step],
        required_document_ids=["doc1"],
    )
    return CaseAnalysis(
        safety_context=SafetyContextSummary(context="none", confidence="high", urgency="none"),
        legal_knowledge=LegalKnowledgeSummary(status="empty"),
        journey=JourneySummary(
            id="journey1",
            case_id=case_id,
            current_situation="Recorded case state.",
            jurisdiction_status="unknown",
            legal_knowledge_status="unavailable",
        ),
        decision_scenario=DecisionScenarioSummary(
            case_id=case_id,
            current_state="Recorded case state.",
            paths=[path],
            required_documents=[requirement],
            next_action="Organize the available records.",
            next_action_reason="Preparation step.",
        ),
    )


if __name__ == "__main__":
    unittest.main()
