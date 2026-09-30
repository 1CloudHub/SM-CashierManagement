/**
 * Per-environment configuration for the LaneWise CDK app.
 *
 * Per ADR-0004 / DEP-005: one CDK app with per-environment configuration.
 * Only `prod` is active today. A `staging` environment (and a manual promotion
 * gate in the pipeline) can be added by populating the commented template below
 * and wiring an extra pipeline stage — no changes to the stacks are required.
 */

/** Supported deployment environments. Add `'staging'` here when it is introduced. */
export type EnvName = 'prod';

export interface EnvironmentConfig {
  /** Logical environment name, used in stack ids, resource names and tags. */
  readonly envName: EnvName;
  /**
   * Target AWS account. Left undefined so the app is environment-agnostic at
   * synth time and resolves account/region from the deploy credentials
   * (CDK_DEFAULT_ACCOUNT / CDK_DEFAULT_REGION) unless overridden here.
   */
  readonly account?: string;
  /** Target AWS region. Undefined => resolved from deploy credentials. */
  readonly region?: string;
  /**
   * Custom domain for the SPA/API, if any. Undefined => use the generated
   * CloudFront and API Gateway domains. Wiring ACM + Route 53 is deferred.
   */
  readonly domainName?: string;
  /** Whether resources should be retained on stack deletion (true for prod). */
  readonly retainData: boolean;
  /** GitHub source wiring for the CI/CD pipeline (CodeStar Connection). */
  readonly github: GitHubSourceConfig;
  /** Tags applied to every stack/resource in this environment. */
  readonly tags: Record<string, string>;
}

/**
 * GitHub source configuration for the CodeStar (GitHub) Connection and the
 * CI/CD pipeline (ADR-0004 / DEP-002).
 *
 * The repo is public today (see ADR-0004); the connection still uses a GitHub
 * App handshake so AWS can source it and report PR status without stored keys.
 */
export interface GitHubSourceConfig {
  /** GitHub org/owner that owns the repository. */
  readonly owner: string;
  /** Repository name. */
  readonly repo: string;
  /** Branch the deploy pipeline tracks (GitHub Flow → single `main`). */
  readonly branch: string;
  /**
   * Human-readable name for the CodeStar Connection resource. The connection is
   * created in a PENDING state by CDK; a one-time GitHub App handshake in the
   * AWS console moves it to AVAILABLE before the pipeline can pull the repo.
   */
  readonly connectionName: string;
}

const BASE_TAGS: Record<string, string> = {
  Project: 'LaneWise',
  Application: 'cashier-staffing-planner',
  ManagedBy: 'cdk',
};

export const environments: Record<EnvName, EnvironmentConfig> = {
  prod: {
    envName: 'prod',
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
    domainName: undefined,
    retainData: true,
    github: {
      owner: '1CloudHub',
      repo: 'SM-CashierManagement',
      branch: 'main',
      connectionName: 'lanewise-prod-github',
    },
    tags: { ...BASE_TAGS, Environment: 'prod' },
  },

  // --- Add `staging` later (ADR-0004 / DEP-005) ---------------------------
  // 1. Add `'staging'` to the EnvName union above.
  // 2. Populate this entry:
  //
  // staging: {
  //   envName: 'staging',
  //   account: process.env.CDK_DEFAULT_ACCOUNT,
  //   region: process.env.CDK_DEFAULT_REGION,
  //   domainName: undefined,
  //   retainData: false,
  //   github: {
  //     owner: '1CloudHub',
  //     repo: 'SM-CashierManagement',
  //     branch: 'main',
  //     connectionName: 'lanewise-staging-github',
  //   },
  //   tags: { ...BASE_TAGS, Environment: 'staging' },
  // },
  //
  // 3. Instantiate the stacks for `staging` in bin/infra.ts and insert a manual
  //    approval (promotion gate) stage before the prod deploy in the pipeline.
};

/**
 * Resolve the environment config for the given name. Defaults to `prod`.
 * Reads the `-c env=<name>` CDK context or the `LANEWISE_ENV` variable.
 */
export function resolveEnvironment(name: string | undefined): EnvironmentConfig {
  const key = (name ?? 'prod') as EnvName;
  const config = environments[key];
  if (!config) {
    const known = Object.keys(environments).join(', ');
    throw new Error(
      `Unknown environment "${name}". Known environments: ${known}. ` +
        'Add it to config/environments.ts before deploying.',
    );
  }
  return config;
}
