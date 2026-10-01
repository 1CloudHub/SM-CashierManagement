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
  /**
   * Home region: SPA hosting (S3 + CloudFront) and the CI/CD stacks
   * (PipelineIam, PipelinePrChecks, DeployPipeline). Must be us-east-1 when a
   * custom domain is set (CloudFront certificate). Undefined => resolved from
   * the deploy credentials (only allowed when `appRegion` is unset too).
   */
  readonly region?: string;
  /**
   * Application region: the VPC-bound application stacks (Auth, Data, Jobs,
   * Location, Api). Undefined => `region`. When it differs from `region`, both
   * must be explicit: the app stacks consume the SPA's CloudFront domain
   * (CORS, passkey relying party) through CDK cross-region references.
   */
  readonly appRegion?: string;
  /**
   * True while copies of the application stacks from before a move to
   * `appRegion` still exist in `region` and import the SpaHosting stack's
   * CloudFront-domain export. Keeps that export so the SpaHosting update does
   * not fail with "export in use"; set false once those copies are deleted
   * (infra/README.md › Application region).
   */
  readonly legacyAppStacksInHomeRegion?: boolean;
  /**
   * Custom domain for the SPA, e.g. `lanewise.prototypes.1cloudhub.com`.
   * When set (with `hostedZone`), SpaHostingStack issues a DNS-validated ACM
   * certificate, adds the alias to CloudFront (the default CloudFront domain
   * keeps working) and creates Route 53 A/AAAA alias records. Undefined => the
   * generated CloudFront domain only. The API keeps its API Gateway domain.
   * The certificate must live in us-east-1 (CloudFront), so the SPA stack must
   * deploy there.
   */
  readonly domainName?: string;
  /** Existing Route 53 public hosted zone that holds `domainName` (required with it). */
  readonly hostedZone?: HostedZoneConfig;
  /** Whether resources should be retained on stack deletion (true for prod). */
  readonly retainData: boolean;
  /** GitHub source wiring for the CI/CD pipeline (CodeStar Connection). */
  readonly github: GitHubSourceConfig;
  /** Cognito user pool / sign-in settings (task 7, requirement 1). */
  readonly auth: AuthConfig;
  /**
   * Demo role switcher (requirement 3, task 8.2): every signed-in user may
   * switch between the 8 roles. Passed to the API as `DEMO_ROLE_SWITCHER`;
   * when false, active roles come only from role assignments (SCR-070/071).
   */
  readonly demoRoleSwitcher: boolean;
  /** Network + Aurora PostgreSQL + uploads bucket (task 24). */
  readonly data: DataConfig;
  /** SQS background-job queue + worker (task 24, for task 14.2). */
  readonly jobs: JobsConfig;
  /** Amazon Location Service map + route calculator (task 24, for tasks 16.1/16.2). */
  readonly location: LocationConfig;
  /** Amazon SES sending for the notifications service (task 24, for task 19). */
  readonly notifications: NotificationsConfig;
  /** Tags applied to every stack/resource in this environment. */
  readonly tags: Record<string, string>;
}

export interface HostedZoneConfig {
  /** Hosted zone id, e.g. `Z10306162UR77DOLJD1L3`. */
  readonly id: string;
  /** Zone apex, e.g. `prototypes.1cloudhub.com`. */
  readonly name: string;
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

/**
 * Authentication configuration (task 7, requirement 1, ADR-0002).
 *
 * Sign-in is passkey-only; the email one-time code is used only to bootstrap
 * or recover a passkey. Email OTP in Cognito requires Amazon SES as the
 * sender, so it is switched on only once a verified SES identity is set here.
 */
export interface AuthConfig {
  /**
   * Demo mode: anyone with an allowlisted email may create their own account
   * (requirement 1.7, Q15). When false, only administrators create users.
   */
  readonly selfSignUp: boolean;
  /**
   * WebAuthn relying party ID (the domain passkeys are bound to). Undefined =>
   * `domainName`, else the SPA's CloudFront domain. Changing it after users
   * register passkeys invalidates every registered passkey.
   */
  readonly relyingPartyId?: string;
  /**
   * Amazon SES sender for the one-time codes. Undefined => email OTP stays OFF
   * (Cognito refuses EMAIL_OTP without SES) and first sign-in cannot complete;
   * `cdk synth` emits a warning. Requires a verified SES identity (out of the
   * SES sandbox) — see infra/README.md › Authentication.
   */
  readonly email?: AuthEmailConfig;
}

export interface AuthEmailConfig {
  /** Verified SES "From" address, e.g. `no-reply@lanewise.smretail.com`. */
  readonly fromEmail: string;
  /** Display name for the From header. */
  readonly fromName?: string;
  /** Verified SES domain identity, when the From address is covered by a domain identity. */
  readonly sesVerifiedDomain?: string;
  /** SES region (must host the verified identity). */
  readonly sesRegion: string;
}

/**
 * Network and data services (task 24, ADR-0002). See infra/README.md
 * "Data services" for the reasoning behind each default.
 */
export interface DataConfig {
  /** Availability zones for the VPC (Aurora needs subnets in >= 2). */
  readonly maxAzs: number;
  /**
   * NAT gateways. 0 => isolated subnets only: functions reach AWS services
   * through the VPC endpoints below and nothing else. >0 adds public +
   * private-with-egress subnets and runs the functions there (required for
   * services without PrivateLink API endpoints, e.g. the SES API).
   */
  readonly natGateways: number;
  /**
   * Interface VPC endpoints (short service names, e.g. `secretsmanager`,
   * `sqs`, `geo.routes`). The S3 gateway endpoint is always added (free).
   */
  readonly interfaceEndpoints: readonly string[];
  /** Aurora Serverless v2 capacity in ACUs. */
  readonly minCapacity: number;
  readonly maxCapacity: number;
  /** Initial database name created in the cluster. */
  readonly databaseName: string;
  /** Automated backup retention (days). */
  readonly backupRetentionDays: number;
  /** Days before an uploaded ingestion file is expired from the uploads bucket. */
  readonly uploadRetentionDays: number;
}

export interface JobsConfig {
  /** Worker Lambda timeout (seconds); the queue visibility timeout is 6x this. */
  readonly workerTimeoutSeconds: number;
  /** Receives before a message moves to the dead-letter queue. */
  readonly maxReceiveCount: number;
  /** Cap on concurrent worker invocations (protects the database). */
  readonly maxConcurrency: number;
}

export interface LocationConfig {
  /** Route/map data provider: `Esri` or `Here` (both cover Metro Manila). */
  readonly dataSource: 'Esri' | 'Here';
  /** Map style for the map resource (must match the data source). */
  readonly mapStyle: string;
}

export interface NotificationsConfig {
  /** Verified SES domain identity the notifications service sends from. */
  readonly sesIdentity: string;
  /** Default From address (must be within `sesIdentity`). */
  readonly fromAddress: string;
  /**
   * Region hosting the verified identity (explicit: it can differ from the
   * region the sending functions run in).
   */
  readonly sesRegion: string;
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
    // SPA hosting + CI/CD stay in us-east-1 (CloudFront, the pipeline). The
    // application stacks run in us-east-2: the account hit its VPC limit in
    // us-east-1 when the Data stack (VPC + Aurora) was first deployed.
    region: 'us-east-1',
    appRegion: 'us-east-2',
    // The pre-move Auth/Api copies in us-east-1 still import the SpaHosting
    // CloudFront-domain export. Set false after deleting them.
    legacyAppStacksInHomeRegion: true,
    // SPA custom domain: PAUSED. The prototypes.1cloudhub.com zone in this
    // account (Z10306162UR77DOLJD1L3) is not the one public DNS delegates to,
    // so the ACM DNS validation never completed and blocked the deploy. Re-enable
    // (domainName: 'lanewise.prototypes.1cloudhub.com', hostedZone: { id, name })
    // once the domain's records live in the authoritative zone.
    domainName: undefined,
    hostedZone: undefined,
    retainData: true,
    github: {
      owner: '1CloudHub',
      repo: 'SM-CashierManagement',
      branch: 'main',
      connectionName: 'lanewise-prod-github',
    },
    auth: {
      // Demo deployment: self sign-up on for the allowlisted domains (Q15).
      selfSignUp: true,
      // Passkeys bind to the SPA's CloudFront domain while the custom domain is
      // paused. Switch to the custom domain BEFORE real users register passkeys;
      // changing it later invalidates every registered passkey.
      relyingPartyId: undefined,
      // One-time codes via SES in us-east-1 (cross-region from the us-east-2
      // user pool): the 1cloudhub.com domain identity is verified (DKIM) there
      // and the account is out of the SES sandbox.
      email: {
        fromEmail: 'noreply@1cloudhub.com',
        fromName: 'LaneWise',
        sesVerifiedDomain: '1cloudhub.com',
        sesRegion: 'us-east-1',
      },
    },
    // Demo deployment: the "Viewing as" role switcher is on.
    demoRoleSwitcher: true,
    data: {
      maxAzs: 2,
      natGateways: 0,
      interfaceEndpoints: ['secretsmanager', 'sqs', 'geo.routes'],
      // The pinned aws-cdk-lib (2.170.0) accepts 0.5 ACU at minimum; scale to
      // zero (0 ACU + auto-pause) needs a newer CDK — see infra/README.md.
      minCapacity: 0.5,
      maxCapacity: 2,
      databaseName: 'lanewise',
      backupRetentionDays: 7,
      uploadRetentionDays: 365,
    },
    jobs: { workerTimeoutSeconds: 300, maxReceiveCount: 3, maxConcurrency: 2 },
    location: { dataSource: 'Here', mapStyle: 'VectorHereExplore' },
    notifications: {
      sesIdentity: '1cloudhub.com',
      fromAddress: 'noreply@1cloudhub.com',
      // The verified identity only exists in us-east-1.
      sesRegion: 'us-east-1',
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
  //   region: 'us-east-1',
  //   appRegion: 'us-east-2',
  //   legacyAppStacksInHomeRegion: false,
  //   domainName: undefined, // e.g. 'lanewise-staging.prototypes.1cloudhub.com'
  //   hostedZone: undefined, // { id: 'Z10306162UR77DOLJD1L3', name: 'prototypes.1cloudhub.com' }
  //   retainData: false,
  //   github: {
  //     owner: '1CloudHub',
  //     repo: 'SM-CashierManagement',
  //     branch: 'main',
  //     connectionName: 'lanewise-staging-github',
  //   },
  //   auth: { selfSignUp: true, relyingPartyId: undefined, email: undefined },
  //   // (or the prod `email` block — SES stays in us-east-1)
  //   demoRoleSwitcher: true,
  //   data: { ...prod data, backupRetentionDays: 1, uploadRetentionDays: 30 },
  //   jobs: { workerTimeoutSeconds: 300, maxReceiveCount: 3, maxConcurrency: 1 },
  //   location: { dataSource: 'Here', mapStyle: 'VectorHereExplore' },
  //   notifications: { sesIdentity: '1cloudhub.com', fromAddress: 'noreply@1cloudhub.com', sesRegion: 'us-east-1' },
  //   tags: { ...BASE_TAGS, Environment: 'staging' },
  // },
  //
  // 3. Instantiate the stacks for `staging` (createLaneWiseStacks in bin/infra.ts) and insert a manual
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
  validateDomain(config);
  validateRegions(config);
  return config;
}

/** The application stacks' region (`appRegion`, else `region`). */
export function appRegionOf(config: EnvironmentConfig): string | undefined {
  return config.appRegion ?? config.region;
}

/** Whether the application stacks deploy to a different region than SPA hosting / CI/CD. */
export function isSplitRegion(config: EnvironmentConfig): boolean {
  return config.appRegion !== undefined && config.appRegion !== config.region;
}

/** Cross-region references need both regions to be explicit. */
export function validateRegions(config: EnvironmentConfig): void {
  if (config.appRegion !== undefined && config.region === undefined) {
    throw new Error(
      `Environment "${config.envName}": appRegion ${config.appRegion} needs an explicit region (the SPA/CI-CD region).`,
    );
  }
}

/** A custom domain needs its hosted zone, and must sit inside it. */
export function validateDomain(config: EnvironmentConfig): void {
  const { domainName, hostedZone } = config;
  if (domainName === undefined) return;
  if (hostedZone === undefined) {
    throw new Error(`Environment "${config.envName}": domainName is set but hostedZone is not.`);
  }
  const zone = hostedZone.name.replace(/\.$/, '').toLowerCase();
  const name = domainName.toLowerCase();
  if (name !== zone && !name.endsWith(`.${zone}`)) {
    throw new Error(`Environment "${config.envName}": domainName ${domainName} is not in hosted zone ${hostedZone.name}.`);
  }
}
