/**
 * Vitest global setup: provides a real PostgreSQL server for the DB tests.
 *
 * - If `TEST_DATABASE_URL` is set (e.g. a Docker `postgres:17` container or a
 *   local server), that server is used. It must point at a database the user
 *   can `CREATE DATABASE` from (typically `.../postgres` as a superuser).
 * - Otherwise an embedded PostgreSQL 17 (npm `embedded-postgres`, prebuilt
 *   binaries per platform) is started on a free port in a throwaway data dir
 *   and stopped afterwards. No Docker daemon is needed, so this runs unchanged
 *   in the CodeBuild standard:7.0 PR check. When running as root (CodeBuild),
 *   a `postgres` OS user is created because PostgreSQL refuses to run as root.
 *
 * Each test file then creates and migrates its own database (see ./db.ts),
 * so files run in parallel without sharing state.
 */
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseAdminUrl: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('could not allocate a port'));
      });
    });
  });
}

export default async function setup(project: TestProject): Promise<(() => Promise<void>) | undefined> {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    project.provide('databaseAdminUrl', external);
    return undefined;
  }

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const port = await freePort();
  const password = randomUUID();
  const logs: string[] = [];
  const server = new EmbeddedPostgres({
    // Not pre-created: embedded-postgres creates it (and chowns it when root).
    databaseDir: join(tmpdir(), `lanewise-pg-${randomUUID()}`),
    port,
    user: 'postgres',
    password,
    authMethod: 'scram-sha-256',
    persistent: false,
    createPostgresUser: typeof process.getuid === 'function' && process.getuid() === 0,
    initdbFlags: ['--encoding=UTF8', '--no-sync'],
    // Fast, disposable test cluster; listen on loopback only.
    postgresFlags: ['-c', 'fsync=off', '-c', 'listen_addresses=127.0.0.1', '-c', 'max_connections=200'],
    onLog: (message) => {
      logs.push(message);
    },
    onError: (error) => {
      logs.push(String(error));
    },
  });

  try {
    await server.initialise();
    await server.start();
  } catch (error) {
    console.error(logs.join(''));
    throw error;
  }

  project.provide('databaseAdminUrl', `postgres://postgres:${password}@127.0.0.1:${port}/postgres`);
  return async () => {
    await server.stop();
  };
}
