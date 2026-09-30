// Bundles the Lambda entry point into a single self-contained ESM file for the
// Node 20 Lambda runtime. The CDK ApiStack (infra/lib/api-stack.ts) deploys
// `dist/lambda/` as the function code with handler `index.handler`.
//
// Bundling here (rather than in CDK via NodejsFunction) keeps `cdk synth` /
// `cdk deploy` free of a bundling step: the deploy stage consumes the bundle
// produced by the build stage (infra/buildspec-deploy.yml).
//
// A second bundle, `dist/migrate/index.mjs` (+ the SQL in
// `dist/migrate/migrations/`), is the `npm run db:migrate` CLI (task 5.1).
//
// A third bundle, `dist/pre-sign-up/index.mjs`, is the Cognito pre-sign-up
// trigger (email-domain allowlist, task 7.2), deployed by the CDK AuthStack
// (infra/lib/auth-stack.ts) with handler `index.handler`.
import { cp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('esbuild').BuildOptions} */
const common = {
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: 'linked',
  minify: false,
  legalComments: 'none',
  // The AWS SDK v3 ships with the Lambda runtime; don't bundle it if used later.
  // pg-native is an optional pg dependency we don't use.
  external: ['@aws-sdk/*', 'pg-native'],
  // CommonJS dependencies (e.g. pg) call require() for Node built-ins; give the
  // ESM bundle a real require.
  banner: {
    js: "import { createRequire as __lwCreateRequire } from 'node:module'; const require = __lwCreateRequire(import.meta.url);",
  },
  logLevel: 'info',
};

const lambdaOut = join(root, 'dist', 'lambda');
await rm(lambdaOut, { recursive: true, force: true });
await build({ ...common, entryPoints: { index: join(root, 'src', 'lambda.ts') }, outdir: lambdaOut });

const migrateOut = join(root, 'dist', 'migrate');
await rm(migrateOut, { recursive: true, force: true });
await build({ ...common, entryPoints: { index: join(root, 'src', 'db', 'migrate-cli.ts') }, outdir: migrateOut });
await cp(join(root, 'migrations'), join(migrateOut, 'migrations'), { recursive: true });

const preSignUpOut = join(root, 'dist', 'pre-sign-up');
await rm(preSignUpOut, { recursive: true, force: true });
await build({
  ...common,
  entryPoints: { index: join(root, 'src', 'triggers', 'pre-sign-up.ts') },
  outdir: preSignUpOut,
});
