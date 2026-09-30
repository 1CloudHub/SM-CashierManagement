#!/usr/bin/env node
// check-docs-conventions.mjs
//
// Validates project documentation against the conventions in
// docs/00-governance/00-conventions.md (GOV-000):
//   - file naming: NN-kebab-case.md (ADRs: ADR-NNNN-kebab-title.md)
//   - front matter: id, title, version, status, owner, last_updated, related
//   - version is SemVer; status is one of the allowed workflow states
//   - requirement IDs referenced in front matter `id` use an allowed prefix
//   - docs/references/ is read-only (checked in CI via git diff, see --changed)
//
// Usage:
//   node scripts/check-docs-conventions.mjs            # check all docs
//   node scripts/check-docs-conventions.mjs --changed  # check only files changed vs origin/main
//
// Exit codes: 0 = OK, 1 = violations found, 2 = script/setup error.
// No external dependencies (Node >= 18 built-ins only) so CodeBuild can run it
// without an extra install step.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, relative, basename, sep } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const DOCS_DIR = join(ROOT, 'docs');
const REFERENCES_DIR = join('docs', 'references');
const TEMPLATES_DIR = join('docs', '_templates');

const REQUIRED_FRONT_MATTER = ['id', 'title', 'version', 'status', 'owner', 'last_updated', 'related'];
// Document workflow states (GOV-000): Draft → In Review → Approved → Superseded.
const ALLOWED_STATUS = ['Draft', 'In Review', 'Approved', 'Superseded'];
// ADRs follow the standard ADR lifecycle in addition to the doc workflow states.
const ALLOWED_ADR_STATUS = ['Proposed', 'Accepted', 'Rejected', 'Deprecated', 'Superseded', ...ALLOWED_STATUS];
const ALLOWED_ID_PREFIXES = [
  'GOV', 'PRD', 'FS', 'DOM', 'NFR', 'SG', 'UX', 'TS', 'DEP', 'OPS', 'SEC', 'PLN', 'ADR',
];
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const FILE_NAME_RE = /^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const ADR_NAME_RE = /^ADR-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

const args = new Set(process.argv.slice(2));
const changedOnly = args.has('--changed');

const errors = [];
const warnings = [];

function fail(file, msg) {
  errors.push(`${file}: ${msg}`);
}
function warn(file, msg) {
  warnings.push(`${file}: ${msg}`);
}

function walkMarkdown(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMarkdown(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function relPath(full) {
  return relative(ROOT, full).split(sep).join('/');
}

function isUnderReferences(rel) {
  return rel === REFERENCES_DIR.split(sep).join('/') || rel.startsWith(REFERENCES_DIR.split(sep).join('/') + '/');
}
function isUnderTemplates(rel) {
  return rel.startsWith(TEMPLATES_DIR.split(sep).join('/') + '/');
}

// Minimal YAML front-matter parser: only the flat key: value pairs we require.
function parseFrontMatter(content) {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = content.slice(3, end).trim();
  const fm = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  return fm;
}

function checkFrontMatter(rel, content) {
  const isAdr = rel.includes('/adr/');
  const fm = parseFrontMatter(content);
  if (!fm) {
    fail(rel, 'missing YAML front matter (must start with a --- fenced block).');
    return;
  }
  for (const key of REQUIRED_FRONT_MATTER) {
    if (!(key in fm) || fm[key] === '') {
      fail(rel, `front matter missing required key "${key}".`);
    }
  }
  if (fm.version && !SEMVER_RE.test(fm.version)) {
    fail(rel, `front matter "version" (${fm.version}) is not SemVer (e.g. 0.1.0).`);
  }
  const allowedStatus = isAdr ? ALLOWED_ADR_STATUS : ALLOWED_STATUS;
  if (fm.status && !allowedStatus.includes(fm.status)) {
    fail(rel, `front matter "status" (${fm.status}) is not one of: ${allowedStatus.join(', ')}.`);
  }
  if (fm.id) {
    const prefix = String(fm.id).split('-')[0];
    if (!ALLOWED_ID_PREFIXES.includes(prefix)) {
      fail(rel, `front matter "id" (${fm.id}) has an unknown prefix "${prefix}". Allowed: ${ALLOWED_ID_PREFIXES.join(', ')}.`);
    }
  }
}

function checkFileName(rel, full) {
  const name = basename(full);
  const isAdr = rel.includes('/adr/');
  if (isAdr) {
    if (!ADR_NAME_RE.test(name) && name !== 'ADR-0000-template.md') {
      fail(rel, `ADR file name "${name}" must match ADR-NNNN-kebab-title.md.`);
    }
    return;
  }
  if (!FILE_NAME_RE.test(name)) {
    fail(rel, `file name "${name}" must match NN-kebab-case.md (lowercase, no spaces/dates).`);
  }
}

function getChangedDocs() {
  // Compare against the merge base with origin/main when available (PR context),
  // else fall back to all docs.
  let base = 'origin/main';
  try {
    execSync(`git rev-parse --verify ${base}`, { stdio: 'ignore' });
  } catch {
    try {
      execSync('git rev-parse --verify main', { stdio: 'ignore' });
      base = 'main';
    } catch {
      return null; // no baseline; caller falls back to full scan
    }
  }
  try {
    const out = execSync(`git diff --name-only --diff-filter=d ${base}...HEAD`, {
      encoding: 'utf8',
    });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function checkReferencesReadOnly() {
  // References are read-only source material: flag any change under docs/references/.
  let base = 'origin/main';
  try {
    execSync(`git rev-parse --verify ${base}`, { stdio: 'ignore' });
  } catch {
    try {
      execSync('git rev-parse --verify main', { stdio: 'ignore' });
      base = 'main';
    } catch {
      return; // cannot determine baseline; skip this check
    }
  }
  let changed = [];
  try {
    const out = execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' });
    changed = out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return;
  }
  for (const rel of changed) {
    if (isUnderReferences(rel)) {
      fail(rel, 'docs/references/ is read-only source material (GOV-000); supersede with a new version instead of editing.');
    }
  }
}

function main() {
  if (!existsSync(DOCS_DIR)) {
    console.error('check-docs-conventions: no docs/ directory found.');
    process.exit(2);
  }

  let files = walkMarkdown(DOCS_DIR).map((f) => f);

  if (changedOnly) {
    const changed = getChangedDocs();
    if (changed) {
      const changedSet = new Set(changed);
      files = files.filter((f) => changedSet.has(relPath(f)));
    }
    // Reference read-only enforcement only makes sense with a git baseline.
    checkReferencesReadOnly();
  }

  for (const full of files) {
    const rel = relPath(full);
    // Skip README indexes at the docs root and templates from front-matter/name rules.
    if (isUnderReferences(rel)) continue; // read-only, not convention-checked
    if (isUnderTemplates(rel)) continue; // templates are exemplars
    if (basename(full) === 'README.md') continue;

    let content;
    try {
      content = readFileSync(full, 'utf8');
    } catch (e) {
      fail(rel, `unable to read file: ${e.message}`);
      continue;
    }
    checkFileName(rel, full);
    checkFrontMatter(rel, content);
  }

  if (warnings.length) {
    console.log('Docs-conventions warnings:');
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }

  if (errors.length) {
    console.error(`\nDocs-conventions check FAILED (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error('\nSee docs/00-governance/00-conventions.md (GOV-000).');
    process.exit(1);
  }

  console.log(`Docs-conventions check passed (${files.length} document${files.length === 1 ? '' : 's'} checked).`);
}

main();
