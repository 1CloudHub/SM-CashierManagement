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
    // SPA custom domain (ACM + CloudFront alias + Route 53) in the existing
    // prototypes.1cloudhub.com public zone (account 675379425271).
    domainName: 'lanewise.prototypes.1cloudhub.com',
    hostedZone: { id: 'Z10306162UR77DOLJD1L3', name: 'prototypes.1cloudhub.com' },
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
      // Passkeys are bound to the custom domain. Set before any passkey was
      // registered; changing it later invalidates every registered passkey.
      relyingPartyId: 'lanewise.prototypes.1cloudhub.com',
      // One-time codes via SES (us-east-1): the 1cloudhub.com domain identity is
      // verified (DKIM) and the account is out of the SES sandbox.
      email: {
        fromEmail: 'noreply@1cloudhub.com',
        fromName: 'LaneWise',
        sesVerifiedDomain: '1cloudhub.com',
        sesRegion: 'us-east-1',
      },
    },
    // Demo deployment: the "Viewing as" role switcher is on.
    demoRoleSwitcher: true,
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
  //   demoRoleSwitcher: true,
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
  validateDomain(config);
  return config;
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
