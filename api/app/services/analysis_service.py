"""Compatibility adapter from canonical orchestration to CaseAnalysis."""

from __future__ import annotations

from app.schemas.case_analysis import CaseAnalysis
from app.schemas.case_state import CaseState


def build_case_analysis(case_state: CaseState) -> CaseAnalysis:
    """Build the established CaseAnalysis response from the persisted case flow.

    The public return type and field contract stay stable. Retrieval,
    reasoning, safety, journey, execution, and simulation now come from the
    same orchestration used by the analysis and journey API routes.
    """
    # Keep this local import: the pipeline's legacy document integrator imports
    # this compatibility service when a document is confirmed.
    from app.services.case_pipeline import run_persisted_case_pipeline

    return run_persisted_case_pipeline(case_state).case_analysis
