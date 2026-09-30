---
inclusion: always
---

# Documentation conventions

- Project-wide specs live in `docs/NN-section/NN-kebab-case.md`. Full rules: `docs/00-governance/00-conventions.md`.
- Every doc has front matter: id, title, version, status, owner, last_updated, related.
- Requirement IDs: `<FR|NFR|BR|UXR>-<AREA>-<NNN>`; never reuse an ID.
- Versioning: SemVer per doc; `0.x` = draft, `1.0.0` = approved. Update the revision table and root `CHANGELOG.md` on every change.
- `docs/references/` is read-only source material.
- Feature specs in `.kiro/specs/<feature>/` reference `docs/` IDs instead of duplicating content.
- All sample figures are from synthetic data; never present them as SM actuals.
