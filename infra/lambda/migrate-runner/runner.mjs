// Deploy-time migration runner (task 24), invoked by the DataStack's CDK
// Trigger. Reads the database credentials from Secrets Manager, builds a TLS
// (verify-full) DATABASE_URL and runs the bundled migrate CLI
// (`index.mjs` + `migrations/`, copied beside this file from api/dist/migrate)
// in a child process, so every invocation gets a fresh CLI run.
//
// Throwing fails the Trigger and therefore the CloudFormation deploy.
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const secrets = new SecretsManagerClient({});

export async function databaseUrl(env = process.env) {
  const { SecretString } = await secrets.send(new GetSecretValueCommand({ SecretId: env.DB_SECRET_ARN }));
  const secret = JSON.parse(SecretString ?? '{}');
  const user = encodeURIComponent(secret.username);
  const password = encodeURIComponent(secret.password);
  const host = env.DB_HOST ?? secret.host;
  const port = env.DB_PORT ?? secret.port ?? 5432;
  const db = encodeURIComponent(env.DB_NAME ?? secret.dbname);
  return `postgres://${user}:${password}@${host}:${port}/${db}?sslmode=${env.DB_SSL_MODE ?? 'verify-full'}`;
}

export async function handler() {
  const DATABASE_URL = await databaseUrl();
  try {
    const { stdout, stderr } = await run(process.execPath, [join(here, 'index.mjs')], {
      env: { ...process.env, DATABASE_URL },
      timeout: 4 * 60 * 1000,
    });
    if (stderr) console.error(stderr.trim());
    console.log(stdout.trim());
    return { ok: true };
  } catch (error) {
    // The CLI logs a JSON error line without credentials; never log the URL.
    console.error(error.stderr?.trim() || error.stdout?.trim() || String(error.code ?? error.signal ?? 'failed'));
    // The child's error carries its argv and output only, never the environment.
    throw new Error('database migrations failed — see the function logs', { cause: error });
  }
}
