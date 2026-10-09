# Legal knowledge core

This package defines the canonical source, authority, version, provision, rule, procedure, document, applicability, provenance, and relationship records. Its registry interface is the boundary for a future file, database, or official-document ingestion adapter. Adapters normalize their input into these records; eligibility checks use the same records regardless of the source adapter.

The seed currently contains only an India jurisdiction node and four issue-topic labels. It contains no legal authority, official source, document, provision, rule, procedure, or legal relationship. The topic labels are intake categories, not statements of law. No official-source catalogs or legal documents are configured in this checkout, so source-backed law has deliberately not been seeded.

An official source catalog must be configured explicitly with `official: true` and its allowed HTTPS hosts. Every registered authority and source needs a reference in that catalog and provenance pointing to the same official reference. A source can be stored while unverified, but the rule-use gate refuses it until it is verified and marked fresh. Version metadata must cover the requested date. Automated applicability checks only compare recorded geographic and effective-date scope; they return `requires_fact_assessment` when those checks pass. Only a recorded human review can set applicability to `applicable`.

`ingestOfficialDocument` accepts a source-specific adapter and a `LegalKnowledgeRegistry`. The adapter turns an official document into a canonical registration package. A persistent repository can implement the registry contract without changing the eligibility gate or any case-state model.
