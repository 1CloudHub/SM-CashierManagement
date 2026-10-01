#!/usr/bin/env node
/**
 * Entry point for `npm run perf` (scripts/perf).
 *
 * The benchmark reuses the API's own toolchain instead of installing anything:
 * `node_modules` here is a symlink to `api/node_modules` (vite-node, pg,
 * embedded-postgres, @lanewise/* — all already installed for the API tests),
 * and bench.ts runs under vite-node so it can import api/src/*.ts directly.
 * Arguments are passed through to bench.ts (see README.md).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const apiModules = join(repo, 'api', 'node_modules');

function fail(message) {
  console.error(`perf: ${message}`);
  process.exit(1);
}

if (!existsSync(join(apiModules, 'vite-node'))) fail('api/node_modules is missing; run `npm ci` in api/ first.');
for (const pkg of ['shared', 'domain', 'matching']) {
  if (!existsSync(join(repo, 'packages', pkg, 'dist', 'index.js'))) fail(`packages/${pkg}/dist is missing; run \`npm run build\` in packages/${pkg} first.`);
}

const link = join(here, 'node_modules');
let isLink = false;
try {
  isLink = lstatSync(link).isSymbolicLink();
} catch {
  symlinkSync(join('..', '..', 'api', 'node_modules'), link, 'dir');
  isLink = true;
}
if (!isLink && !existsSync(join(link, 'vite-node'))) fail(`${link} exists but is not the api/node_modules link.`);

const bin = join(apiModules, 'vite-node', 'vite-node.mjs');
const result = spawnSync(process.execPath, [bin, '--config', join(here, 'vite.config.mjs'), join(here, 'bench.ts'), '--', ...process.argv.slice(2)], {
  cwd: here,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'production' },
});
process.exit(result.status ?? 1);
