// Bundles the Lambda entry point into a single self-contained ESM file for the
// Node 20 Lambda runtime. The CDK ApiStack (infra/lib/api-stack.ts) deploys
// `dist/lambda/` as the function code with handler `index.handler`.
//
// Bundling here (rather than in CDK via NodejsFunction) keeps `cdk synth` /
// `cdk deploy` free of a bundling step: the deploy stage consumes the bundle
// produced by the build stage (infra/buildspec-deploy.yml).
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = join(root, 'dist', 'lambda');

await rm(outdir, { recursive: true, force: true });

await build({
  entryPoints: { index: join(root, 'src', 'lambda.ts') },
  outdir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: 'linked',
  minify: false,
  legalComments: 'none',
  // The AWS SDK v3 ships with the Lambda runtime; don't bundle it if used later.
  external: ['@aws-sdk/*'],
  logLevel: 'info',
});
