#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { resolveEnvironment } from '../config/environments';
import { createLaneWiseStacks } from '../lib/lanewise-app';

const app = new App();

// Environment is selected via `-c env=<name>` context or LANEWISE_ENV; defaults
// to prod (the only active environment today). Adding `staging` is a config +
// wiring change only — see config/environments.ts (ADR-0004 / DEP-005).
const envName = app.node.tryGetContext('env') ?? process.env.LANEWISE_ENV;
const config = resolveEnvironment(envName);

// SPA hosting + CI/CD in `config.region` (us-east-1); Auth, Data, Jobs,
// Location and Api in `config.appRegion` (prod: us-east-2) — see
// lib/lanewise-app.ts for the stack wiring and cross-region references.
createLaneWiseStacks(app, config);

// Apply per-environment tags to every resource in the app.
for (const [key, value] of Object.entries(config.tags)) {
  Tags.of(app).add(key, value);
}

app.synth();
