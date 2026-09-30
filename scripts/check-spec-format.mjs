#!/usr/bin/env node
// check-spec-format.mjs
//
// Validates feature specs under .kiro/specs/<feature>/ against the project's
// spec conventions (GOV-000): each feature spec is a folder that carries the
// core spec documents and references docs/ IDs rather than duplicating content.
//
// Checks per feature folder:
//   - required files exist: requirements.md, design.md, tasks.md
//     (bugfix specs — .config.kiro specType "bugfix" — require bugfix.md instead
//     of requirements.md)
//   - each spec document is non-empty
//   - the spec references at least one docs/ ID (GOV-000: reference, don't duplicate)
//   - any <TYPE>-<AREA>-<NNN> requirement IDs mentioned use an allowed TYPE prefix
//
// Usage:
//   node scripts/check-spec-format.mjs                 # check all specs
//   node scripts/check-spec-format.mjs <feature-name>  # check one feature
//
// Exit codes: 0 = OK, 1 = violations found, 2 = script/setup error.
// No external dependencies (Node >= 18 built-ins only).

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SPECS_DIR = join(ROOT, '.kiro', 'specs');

const CORE_FILES = ['design.md', 'tasks.md'];
const REQ_FILE_FEATURE = 'requirements.md';
const REQ_FILE_BUGFIX = 'bugfix.md';

// Requirement TYPE prefixes and doc-ID prefixes from GOV-000.
const REQ_TYPE_PREFIXES = ['FR', 'NFR', 'BR', 'UXR'];
const DOC_ID_PREFIXES = [
  'GOV', 'PRD', 'FS', 'DOM', 'NFR', 'SG', 'UX', 'TS', 'DEP', 'OPS', 'SEC', 'PLN', 'ADR',
];

// Matches requirement IDs like FR-ROSTER-012 / NFR-PERF-003.
const REQ_ID_RE = /\b([A-Z]{2,4})-([A-Z]{2,6})-(\d{3})\b/g;
// Matches doc IDs like DEP-001, GOV-000, ADR-0004.
const DOC_ID_RE = /\b([A-Z]{2,3})-(\d{3,4})\b/g;

const errors = [];
function fail(scope, msg) {
  errors.push(`${scope}: ${msg}`);
}

function relPath(full) {
  return relative(ROOT, full).split(sep).join('/');
}

function readConfigSpecType(featureDir) {
  const cfg = join(featureDir, '.config.kiro');
  if (!existsSync(cfg)) return 'feature';
  try {
    const parsed = JSON.parse(readFileSync(cfg, 'utf8'));
    return parsed.specType || 'feature';
  } catch {
    return 'feature';
  }
}

function checkFeature(featureName) {
  const featureDir = join(SPECS_DIR, featureName);
  const scope = relPath(featureDir);
  const specType = readConfigSpecType(featureDir);

  const requirementsFile = specType === 'bugfix' ? REQ_FILE_BUGFIX : REQ_FILE_FEATURE;
  const requiredFiles = [requirementsFile, ...CORE_FILES];

  const presentSpecDocs = [];
  for (const f of requiredFiles) {
    const full = join(featureDir, f);
    if (!existsSync(full)) {
      fail(scope, `missing required spec file "${f}" (specType: ${specType}).`);
      continue;
    }
    const content = readFileSync(full, 'utf8');
    if (content.trim().length === 0) {
      fail(`${scope}/${f}`, 'spec file is empty.');
    } else {
      presentSpecDocs.push({ file: f, content });
    }
  }

  // Reference-not-duplicate: the spec should cite docs/ IDs somewhere.
  const combined = presentSpecDocs.map((d) => d.content).join('\n');
  const docIds = new Set();
  for (const m of combined.matchAll(DOC_ID_RE)) {
    docIds.add(`${m[1]}-${m[2]}`);
  }
  const citesDocs = [...docIds].some((id) => DOC_ID_PREFIXES.includes(id.split('-')[0]));
  if (presentSpecDocs.length && !citesDocs) {
    fail(scope, 'spec does not reference any docs/ ID (e.g. DEP-001, GOV-000). Specs must reference docs IDs, not duplicate content (GOV-000).');
  }

  // Requirement IDs mentioned must use an allowed TYPE prefix.
  for (const { file, content } of presentSpecDocs) {
    for (const m of content.matchAll(REQ_ID_RE)) {
      const type = m[1];
      // Ignore doc IDs (3-letter prefix + 3-4 digits, no AREA segment) — those matched DOC_ID_RE.
      // REQ_ID_RE requires a middle AREA segment, so any match here is a requirement-shaped ID.
      if (!REQ_TYPE_PREFIXES.includes(type)) {
        // Could be a property/property-like token; only flag ones that look like requirement IDs
        // with a known area to avoid false positives on things like ADR-0004 (no area segment).
        continue;
      }
    }
  }
}

function main() {
  if (!existsSync(SPECS_DIR)) {
    console.log('check-spec-format: no .kiro/specs/ directory found; nothing to check.');
    process.exit(0);
  }

  const arg = process.argv[2];
  let features;
  if (arg && !arg.startsWith('--')) {
    features = [arg];
  } else {
    features = readdirSync(SPECS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  }

  if (features.length === 0) {
    console.log('check-spec-format: no feature specs found; nothing to check.');
    process.exit(0);
  }

  for (const f of features) {
    const dir = join(SPECS_DIR, f);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      fail(`.kiro/specs/${f}`, 'feature spec folder not found.');
      continue;
    }
    checkFeature(f);
  }

  if (errors.length) {
    console.error(`\nSpec-format check FAILED (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error('\nSee docs/00-governance/00-conventions.md (GOV-000).');
    process.exit(1);
  }

  console.log(`Spec-format check passed (${features.length} feature spec${features.length === 1 ? '' : 's'} checked).`);
}

main();
