import * as fs from 'node:fs';
import * as path from 'node:path';
import { Annotations, CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments';

/**
 * Session/token policy (requirement 1.8, Q12). Mirrors `SESSION_POLICY` in
 * `@lanewise/shared` (the SPA's idle timer): ID/access tokens live exactly as
 * long as the idle timeout, the refresh token caps a session at one working
 * day, and the SPA revokes it on idle sign-out.
 */
export const TOKEN_POLICY = {
  accessTokenMinutes: 60,
  idTokenMinutes: 60,
  refreshTokenHours: 12,
  /** How long an email one-time code / passkey challenge session stays open. */
  authSessionMinutes: 10,
} as const;

/** Default location of the pre-sign-up bundle produced by `api/scripts/bundle.mjs`. */
export const DEFAULT_PRE_SIGN_UP_BUNDLE_DIR = path.join(__dirname, '..', '..', 'api', 'dist', 'pre-sign-up');

export interface AuthStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  /**
   * WebAuthn relying party ID — the domain passkeys are bound to. Normally the
   * SPA's CloudFront domain (or `config.auth.relyingPartyId`).
   */
  readonly relyingPartyId: string;
  /** Directory holding the bundled pre-sign-up trigger (`index.mjs`). */
  readonly preSignUpBundleDir?: string;
}

function assertBundle(dir: string): void {
  if (!fs.existsSync(path.join(dir, 'index.mjs'))) {
    throw new Error(
      `Pre-sign-up bundle not found at ${dir}/index.mjs. Build it first: ` +
        '(cd packages/shared && npm ci && npm run build) && (cd api && npm ci && npm run build)',
    );
  }
}

/**
 * Authentication: Amazon Cognito user pool with passkey (WebAuthn) sign-in
 * (task 7.1/7.2, requirement 1, ADR-0002).
 *
 *  - **Passkey-first, no password path.** The app client allows only the
 *    choice-based `USER_AUTH` flow (+ refresh); the SRP / plain-password client
 *    flows are off. Users sign up without a password and the SPA never offers
 *    one. Cognito requires `PASSWORD` to stay in the pool's allowed first
 *    factors, so the password policy is set to the maximum and account
 *    recovery (the forgot-password path) is disabled — see PR notes.
 *  - **Email one-time code** (`EMAIL_OTP`) is enabled only when SES is
 *    configured; the SPA uses it only to register or recover a passkey.
 *  - **Domain allowlist** (P13): a pre-sign-up trigger rejects every creation
 *    path for emails outside smretail.com / 1cloudhub.com, and `email` is
 *    immutable so it can't be changed afterwards.
 *  - **Self sign-up** follows the demo-mode flag (requirement 1.7).
 *
 * aws-cdk-lib 2.170 predates the Cognito passkey L2 props, so the Essentials
 * tier, WebAuthn and sign-in policy settings are applied as CloudFormation
 * property overrides (asserted in infra/test/stacks.test.ts).
 */
export class AuthStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly preSignUpFunction: lambda.Function;
  /** The first factors the pool allows (asserted by tests). */
  public readonly allowedFirstAuthFactors: readonly string[];

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { config } = props;
    const removalPolicy = config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const bundleDir = props.preSignUpBundleDir ?? DEFAULT_PRE_SIGN_UP_BUNDLE_DIR;
    assertBundle(bundleDir);

    const triggerLogs = new logs.LogGroup(this, 'PreSignUpLogs', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy,
    });

    this.preSignUpFunction = new lambda.Function(this, 'PreSignUpFunction', {
      functionName: `lanewise-${config.envName}-pre-sign-up`,
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(bundleDir),
      timeout: Duration.seconds(5),
      memorySize: 128,
      description: 'LaneWise Cognito pre-sign-up trigger: smretail.com / 1cloudhub.com allowlist (P13).',
      logGroup: triggerLogs,
      environment: {
        LANEWISE_ENV: config.envName,
        SELF_SIGN_UP_ENABLED: String(config.auth.selfSignUp),
        NODE_OPTIONS: '--enable-source-maps',
      },
    });

    const emailOtpEnabled = config.auth.email !== undefined;
    const email = config.auth.email
      ? cognito.UserPoolEmail.withSES({
          fromEmail: config.auth.email.fromEmail,
          ...(config.auth.email.fromName ? { fromName: config.auth.email.fromName } : {}),
          ...(config.auth.email.sesVerifiedDomain ? { sesVerifiedDomain: config.auth.email.sesVerifiedDomain } : {}),
          sesRegion: config.auth.email.sesRegion,
        })
      : cognito.UserPoolEmail.withCognito();

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `lanewise-${config.envName}-users`,
      selfSignUpEnabled: config.auth.selfSignUp,
      // Email is the username; case-insensitive so Juan@ and juan@ are one user.
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      // Immutable email: an allowlisted address can't be swapped afterwards (P13).
      standardAttributes: { email: { required: true, mutable: false } },
      mfa: cognito.Mfa.OFF,
      // No forgot-password path: recovery is a new passkey via email code.
      accountRecovery: cognito.AccountRecovery.NONE,
      // Passwords are never used. The strictest policy makes the PASSWORD
      // factor Cognito insists on impractical to adopt.
      passwordPolicy: {
        minLength: 99,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(1),
      },
      email,
      lambdaTriggers: { preSignUp: this.preSignUpFunction },
      deletionProtection: config.retainData,
      removalPolicy,
    });

    // Passkeys need the Essentials feature plan and the choice-based sign-in
    // policy (not in the aws-cdk-lib 2.170 L2 — see class doc).
    this.allowedFirstAuthFactors = emailOtpEnabled ? ['PASSWORD', 'WEB_AUTHN', 'EMAIL_OTP'] : ['PASSWORD', 'WEB_AUTHN'];
    const cfnPool = this.userPool.node.defaultChild as cognito.CfnUserPool;
    cfnPool.addPropertyOverride('UserPoolTier', 'ESSENTIALS');
    cfnPool.addPropertyOverride('WebAuthnRelyingPartyID', props.relyingPartyId);
    cfnPool.addPropertyOverride('WebAuthnUserVerification', 'required');
    cfnPool.addPropertyOverride('Policies.SignInPolicy.AllowedFirstAuthFactors', [...this.allowedFirstAuthFactors]);

    if (!emailOtpEnabled) {
      Annotations.of(this).addWarningV2(
        'lanewise:auth:email-otp-disabled',
        'Email one-time codes are OFF: config.auth.email (a verified Amazon SES identity) is not set, so first ' +
          'sign-in / new-device passkey registration cannot complete. See infra/README.md › Authentication.',
      );
    }

    this.userPoolClient = this.userPool.addClient('SpaClient', {
      userPoolClientName: `lanewise-${config.envName}-spa`,
      generateSecret: false,
      disableOAuth: true,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.minutes(TOKEN_POLICY.accessTokenMinutes),
      idTokenValidity: Duration.minutes(TOKEN_POLICY.idTokenMinutes),
      refreshTokenValidity: Duration.hours(TOKEN_POLICY.refreshTokenHours),
      authSessionValidity: Duration.minutes(TOKEN_POLICY.authSessionMinutes),
      readAttributes: new cognito.ClientAttributes().withStandardAttributes({
        email: true,
        emailVerified: true,
        fullname: true,
      }),
      // SignUp must write `email`; it is immutable after creation.
      writeAttributes: new cognito.ClientAttributes().withStandardAttributes({ email: true }),
    });
    // Only choice-based sign-in (passkey / email code) and refresh; no SRP or
    // plain-password client flows (ALLOW_USER_AUTH isn't in the 2.170 L2).
    (this.userPoolClient.node.defaultChild as cognito.CfnUserPoolClient).addPropertyOverride('ExplicitAuthFlows', [
      'ALLOW_USER_AUTH',
      'ALLOW_REFRESH_TOKEN_AUTH',
    ]);

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId, description: 'Cognito user pool id.' });
    new CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito app client id for the SPA.',
    });
    new CfnOutput(this, 'RelyingPartyId', {
      value: props.relyingPartyId,
      description: 'WebAuthn relying party id (passkeys are bound to this domain).',
    });
    new CfnOutput(this, 'SelfSignUpEnabled', { value: String(config.auth.selfSignUp) });
    new CfnOutput(this, 'EmailOtpEnabled', { value: String(emailOtpEnabled) });
  }
}
