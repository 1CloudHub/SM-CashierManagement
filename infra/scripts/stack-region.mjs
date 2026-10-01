#!/usr/bin/env node
// Prints the AWS region a stack of the synthesized CDK app deploys to, read
// from the cloud assembly manifest (`cdk.out/manifest.json`) that `cdk deploy`
// leaves behind. The deploy stage (buildspec-cdk-deploy.yml) uses it to query
// each stack's outputs in its own region — SPA hosting in `config.region`,
// Auth/Api in `config.appRegion` — without repeating the regions.
//
//   node scripts/stack-region.mjs <stack-name> [cdk.out]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Region of `stackName` in the manifest, or throws when it is missing/unresolved. */
export function stackRegion(manifest, stackName) {
  const artifact = manifest.artifacts?.[stackName];
  if (!artifact || artifact.type !== 'aws:cloudformation:stack') {
    throw new Error(`Stack ${stackName} is not in the cloud assembly.`);
  }
  // aws://<account>/<region>
  const region = /^aws:\/\/[^/]+\/(.+)$/.exec(artifact.environment ?? '')?.[1];
  if (!region || region === 'unknown-region') {
    throw new Error(`Stack ${stackName} has no explicit region (${artifact.environment}).`);
  }
  return region;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [stackName, outDir = 'cdk.out'] = process.argv.slice(2);
  if (!stackName) {
    console.error('usage: stack-region.mjs <stack-name> [cdk.out]');
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8'));
  console.log(stackRegion(manifest, stackName));
}
