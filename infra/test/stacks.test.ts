import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { App } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { type EnvironmentConfig, resolveEnvironment, validateDomain } from '../config/environments';
import { ApiStack, DEFAULT_API_BUNDLE_DIR, PROTECTED_ROUTES } from '../lib/api-stack';
import { AuthStack, DEFAULT_PRE_SIGN_UP_BUNDLE_DIR, TOKEN_POLICY } from '../lib/auth-stack';
import { DeployPipelineStack } from '../lib/deploy-pipeline-stack';
import { PipelineIamStack } from '../lib/pipeline-iam-stack';
import { PipelinePrChecksStack } from '../lib/pipeline-pr-checks-stack';
import { SpaHostingStack } from '../lib/spa-hosting-stack';

function synth() {
  const app = new App();
  const config = withDomain();
  const spa = new SpaHostingStack(app, 'Test-SpaHosting', { config });
  // Mirrors bin/infra.ts.
  const auth = new AuthStack(app, 'Test-Auth', {
    config,
    relyingPartyId: config.auth.relyingPartyId ?? config.domainName ?? spa.distribution.distributionDomainName,
  });
  const api = new ApiStack(app, 'Test-Api', { config, userPool: auth.userPool, allowedOrigins: spa.spaOrigins });
  const pipelineIam = new PipelineIamStack(app, 'Test-PipelineIam', { config });
  const pipelinePrChecks = new PipelinePrChecksStack(app, 'Test-PipelinePrChecks', {
    config,
    codeBuildRoleArn: pipelineIam.codeBuildRole.roleArn,
    connectionArn: pipelineIam.connectionArn,
  });
  const deployPipeline = new DeployPipelineStack(app, 'Test-DeployPipeline', {
    config,
    connectionArn: pipelineIam.connectionArn,
    pipelineRoleArn: pipelineIam.pipelineRole.roleArn,
    codeBuildRoleArn: pipelineIam.codeBuildRole.roleArn,
  });
  return {
    spa: Template.fromStack(spa),
    spaStack: spa,
    api: Template.fromStack(api),
    auth: Template.fromStack(auth),
    authStack: auth,
    pipelineIam: Template.fromStack(pipelineIam),
    pipelinePrChecks: Template.fromStack(pipelinePrChecks),
    prChecksStack: pipelinePrChecks,
    deployPipeline: Template.fromStack(deployPipeline),
    deployPipelineStack: deployPipeline,
  };
}

const DOMAIN = 'lanewise.prototypes.1cloudhub.com';
const ZONE_ID = 'Z02168532NL1LBQPBHSV0';

/**
 * Prod config with the custom domain switched on. Prod currently has the custom
 * domain paused (config/environments.ts); these tests keep the domain code path
 * covered so it can be re-enabled by config alone.
 */
function withDomain(): EnvironmentConfig {
  const base = resolveEnvironment('prod');
  return {
    ...base,
    domainName: DOMAIN,
    hostedZone: { id: ZONE_ID, name: 'lanewise.prototypes.1cloudhub.com' },
    auth: { ...base.auth, relyingPartyId: DOMAIN },
  };
}

/** Prod config with the custom domain, relying party and SES sender removed. */
function withoutDomainOrEmail(): EnvironmentConfig {
  const base = resolveEnvironment('prod');
  return {
    ...base,
    domainName: undefined,
    hostedZone: undefined,
    auth: { ...base.auth, relyingPartyId: undefined, email: undefined },
  };
}

describe('SPA hosting stack', () => {
  const { spa } = synth();

  it('creates a private, encrypted S3 bucket', () => {
    spa.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('serves the SPA via CloudFront with OAC and index.html fallback', () => {
    spa.resourceCountIs('AWS::CloudFront::Distribution', 1);
    spa.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    spa.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        DefaultRootObject: 'index.html',
        CustomErrorResponses: [
          { ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html' },
          { ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html' },
        ],
      },
    });
  });
});

describe('SPA custom domain (prod: lanewise.prototypes.1cloudhub.com)', () => {
  const { spa, spaStack } = synth();

  it('issues a DNS-validated ACM certificate in the prototypes.1cloudhub.com zone', () => {
    spa.resourceCountIs('AWS::CertificateManager::Certificate', 1);
    spa.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: DOMAIN,
      ValidationMethod: 'DNS',
      DomainValidationOptions: [{ DomainName: DOMAIN, HostedZoneId: ZONE_ID }],
    });
  });

  it('asserts at deploy time that the certificate stack is in us-east-1 (CloudFront)', () => {
    const rules = spa.toJSON().Rules as Record<string, { Assertions: Array<{ Assert: unknown }> }>;
    expect(rules.CertificateRegionRule?.Assertions[0]?.Assert).toEqual({
      'Fn::Equals': [{ Ref: 'AWS::Region' }, 'us-east-1'],
    });
  });

  it('attaches the certificate and the alias to CloudFront (SNI, TLS 1.2+)', () => {
    spa.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: [DOMAIN],
        ViewerCertificate: {
          AcmCertificateArn: { Ref: Match.stringLikeRegexp('SpaCertificate') },
          SslSupportMethod: 'sni-only',
          MinimumProtocolVersion: 'TLSv1.2_2021',
        },
      }),
    });
  });

  it('creates Route 53 A and AAAA alias records for the name, and nothing else in the zone', () => {
    spa.resourceCountIs('AWS::Route53::RecordSet', 2);
    for (const type of ['A', 'AAAA']) {
      spa.hasResourceProperties('AWS::Route53::RecordSet', {
        Name: `${DOMAIN}.`,
        Type: type,
        HostedZoneId: ZONE_ID,
        AliasTarget: {
          DNSName: { 'Fn::GetAtt': [Match.stringLikeRegexp('SpaDistribution'), 'DomainName'] },
          HostedZoneId: Match.anyValue(),
        },
      });
    }
    spa.resourceCountIs('AWS::Route53::HostedZone', 0);
  });

  it('serves on the custom domain and keeps the CloudFront domain', () => {
    expect(spaStack.spaOrigins).toHaveLength(2);
    expect(spaStack.spaOrigins[0]).toBe(`https://${DOMAIN}`);
    spa.hasOutput('SpaUrl', { Value: `https://${DOMAIN}` });
    spa.hasOutput('DistributionDomainName', Match.anyValue());
  });

  it('adds no certificate, alias or DNS records when no domain is configured', () => {
    const t = Template.fromStack(new SpaHostingStack(new App(), 'Test-Spa-NoDomain', { config: withoutDomainOrEmail() }));
    t.resourceCountIs('AWS::CertificateManager::Certificate', 0);
    t.resourceCountIs('AWS::Route53::RecordSet', 0);
    const dist = Object.values(t.findResources('AWS::CloudFront::Distribution'))[0] as {
      Properties: { DistributionConfig: Record<string, unknown> };
    };
    expect(dist.Properties.DistributionConfig.Aliases).toBeUndefined();
    expect(dist.Properties.DistributionConfig.ViewerCertificate).toBeUndefined();
    expect(Object.keys(t.toJSON().Rules ?? {})).not.toContain('CertificateRegionRule');
  });

  it('refuses a custom domain in a stack pinned outside us-east-1', () => {
    expect(
      () =>
        new SpaHostingStack(new App(), 'Test-Spa-WrongRegion', {
          config: withDomain(),
          env: { region: 'ap-southeast-1' },
        }),
    ).toThrowError(/us-east-1/);
  });

  it('validates that a custom domain has a hosted zone and sits inside it', () => {
    const base = withDomain();
    expect(() => validateDomain(base)).not.toThrow();
    expect(() => validateDomain({ ...base, hostedZone: undefined })).toThrowError(/hostedZone/);
    expect(() => validateDomain({ ...base, domainName: 'lanewise.1cloudhub.com' })).toThrowError(/not in hosted zone/);
    expect(() => validateDomain({ ...base, domainName: 'evilprototypes.1cloudhub.com' })).toThrowError(
      /not in hosted zone/,
    );
  });
});

describe('API stack', () => {
  const { api } = synth();

  it('runs the bundled API service as a single Node 20 Lambda', () => {
    api.resourceCountIs('AWS::Lambda::Function', 1);
    api.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'lanewise-prod-api',
      Runtime: 'nodejs20.x',
      Handler: 'index.handler',
      Environment: {
        Variables: Match.objectLike({ LANEWISE_ENV: 'prod', NODE_OPTIONS: '--enable-source-maps' }),
      },
    });
  });

  it('writes function logs to a retained log group with a retention period', () => {
    api.resourceCountIs('AWS::Logs::LogGroup', 1);
    api.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 90 });
    api.hasResource('AWS::Logs::LogGroup', { DeletionPolicy: 'Retain' });
  });

  it('exposes a REST API with GET /health proxied to the API function', () => {
    api.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    api.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: 'health' });
    api.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'GET',
      AuthorizationType: 'NONE',
      Integration: Match.objectLike({ Type: 'AWS_PROXY' }),
    });
  });

  it('grants API Gateway one API-wide invoke permission (stays under the 20 KB Lambda policy limit)', () => {
    api.resourceCountIs('AWS::Lambda::Permission', 1);
    api.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'apigateway.amazonaws.com',
    });
  });

  it('protects every other route with the Cognito user-pool authorizer (feature routes secure by default)', () => {
    api.resourceCountIs('AWS::ApiGateway::Authorizer', 1);
    api.hasResourceProperties('AWS::ApiGateway::Authorizer', {
      Type: 'COGNITO_USER_POOLS',
      IdentitySource: 'method.request.header.Authorization',
      ProviderARNs: [Match.anyValue()],
    });
    api.hasResourceProperties('AWS::ApiGateway::Resource', { PathPart: '{proxy+}' });
    api.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'ANY',
      AuthorizationType: 'COGNITO_USER_POOLS',
      AuthorizerId: Match.anyValue(),
      Integration: Match.objectLike({ Type: 'AWS_PROXY' }),
    });
  });

  it('leaves only /health and CORS preflight unauthenticated', () => {
    const methods = api.findResources('AWS::ApiGateway::Method');
    for (const [, m] of Object.entries(methods)) {
      const props = (m as { Properties: { HttpMethod: string; AuthorizationType: string } }).Properties;
      if (props.AuthorizationType === 'NONE') {
        expect(['GET', 'OPTIONS']).toContain(props.HttpMethod);
      }
    }
    const unauthenticatedGets = Object.values(methods).filter((m) => {
      const p = (m as { Properties: { HttpMethod: string; AuthorizationType: string } }).Properties;
      return p.HttpMethod === 'GET' && p.AuthorizationType === 'NONE';
    });
    expect(unauthenticatedGets).toHaveLength(1);
    // Both `/` and `/{proxy+}` ANY methods carry the authorizer.
    const anyMethods = Object.values(methods).filter(
      (m) => (m as { Properties: { HttpMethod: string } }).Properties.HttpMethod === 'ANY',
    );
    expect(anyMethods).toHaveLength(2);
    for (const m of anyMethods) {
      expect((m as { Properties: { AuthorizationType: string } }).Properties.AuthorizationType).toBe('COGNITO_USER_POOLS');
    }
  });

  it('declares every API feature route behind the Cognito authorizer (task 8.1)', () => {
    const resources = api.findResources('AWS::ApiGateway::Resource');
    const methods = api.findResources('AWS::ApiGateway::Method');
    const pathOf = (id: string): string => {
      const r = resources[id] as { Properties: { PathPart: string; ParentId: unknown } } | undefined;
      if (!r) return '';
      const parent = r.Properties.ParentId as { Ref?: string };
      return `${parent.Ref ? pathOf(parent.Ref) : ''}/${r.Properties.PathPart}`;
    };
    const declared = Object.values(methods).map((m) => {
      const p = (m as { Properties: { HttpMethod: string; AuthorizationType: string; ResourceId: { Ref?: string } } })
        .Properties;
      return { key: `${p.HttpMethod} ${p.ResourceId.Ref ? pathOf(p.ResourceId.Ref) : '/'}`, auth: p.AuthorizationType };
    });
    expect(PROTECTED_ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining([
        'GET /me',
        'PUT /me/active-role',
        'GET /stores',
        'GET /stores/{storeId}',
        'GET /search',
        'GET /saved-views',
        'POST /saved-views',
        'PATCH /saved-views/{viewId}',
        'DELETE /saved-views/{viewId}',
        // Task 9 (data ingestion, snapshots, provenance).
        'GET /datasets',
        'GET /datasets/provenance',
        'POST /ingestions/uploads',
        'POST /ingestions',
        'GET /ingestions',
        'GET /ingestions/export',
        'GET /ingestions/{ingestionId}',
        'GET /ingestions/{ingestionId}/report',
        'POST /ingestions/{ingestionId}/load',
        'POST /ingestions/{ingestionId}/cancel',
        'GET /snapshots',
        'GET /snapshots/{snapshotId}',
        'PATCH /snapshots/{snapshotId}',
      ]),
    );
    // Task 15 location-privacy routes (api/src/routes/location-privacy.ts).
    expect(PROTECTED_ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining([
        'GET /me/consents',
        'POST /me/consents',
        'DELETE /me/consents/{purpose}',
        'GET /me/home-area',
        'PUT /me/home-area',
        'DELETE /me/home-area',
        'GET /me/home-area/barangays',
        'GET /staff/{staffId}/home-area',
      ]),
    );
    for (const route of PROTECTED_ROUTES) {
      const match = declared.filter((d) => d.key === `${route.method} ${route.path}`);
      expect(match, `${route.method} ${route.path}`).toHaveLength(1);
      expect(match[0]?.auth).toBe('COGNITO_USER_POOLS');
    }
  });

  it('protects every task 10 rule route with the Cognito authorizer', () => {
    expect(PROTECTED_ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining([
        'GET /rule-sets',
        'GET /rule-sets/{ruleSetId}/versions',
        'POST /rule-sets/{ruleSetId}/versions',
        'GET /rule-versions/{versionId}',
        'PATCH /rule-versions/{versionId}',
        'POST /rule-versions/{versionId}/submit',
        'POST /rule-versions/{versionId}/approve',
        'POST /rule-versions/{versionId}/request-changes',
        'POST /rule-versions/{versionId}/publish',
        'POST /rule-versions/{versionId}/approve-and-publish',
        'GET /rule-versions/{versionId}/diff',
      ]),
    );
  });

  it('protects every task 11 scenario route with the Cognito authorizer', () => {
    expect(PROTECTED_ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining([
        'GET /scenarios',
        'POST /scenarios',
        'GET /scenarios/compare',
        'GET /scenarios/{scenarioId}',
        'PATCH /scenarios/{scenarioId}',
        'POST /scenarios/{scenarioId}/duplicate',
        'POST /scenarios/{scenarioId}/refresh',
        'POST /scenarios/{scenarioId}/run',
        'POST /scenarios/{scenarioId}/submit',
        'POST /scenarios/{scenarioId}/archive',
      ]),
    );
  });

  it('protects every task 12 approval route with the Cognito authorizer', () => {
    expect(PROTECTED_ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual(
      expect.arrayContaining([
        'GET /approvals',
        'GET /approvals/{scenarioId}',
        'POST /approvals/{scenarioId}/headcount',
        'POST /approvals/{scenarioId}/budget',
        'POST /approvals/{scenarioId}/plan',
        'POST /approvals/{scenarioId}/secured-outside',
      ]),
    );
  });

  it('protects every master data route (stores, departments, staff and availability; SCR-052/053) with the Cognito authorizer', () => {
    const expected = [
      'GET /stores',
      'GET /stores/{storeId}',
      'POST /stores',
      'PATCH /stores/{storeId}',
      'PATCH /departments/{departmentId}',
      'GET /staff',
      'POST /staff',
      'GET /staff/{staffId}',
      'PATCH /staff/{staffId}',
      'PUT /staff/{staffId}/availability',
      'POST /staff/{staffId}/unavailable-dates',
      'DELETE /staff/{staffId}/unavailable-dates/{entryId}',
      'GET /staff/{staffId}/home-area',
    ];
    expect(PROTECTED_ROUTES.map((r) => `${r.method} ${r.path}`)).toEqual(expect.arrayContaining(expected));
    const methods = Object.values(api.findResources('AWS::ApiGateway::Method')).map(
      (m) => (m as { Properties: { HttpMethod: string; AuthorizationType: string } }).Properties,
    );
    // Every protected method (these included) sits behind the Cognito authorizer.
    expect(methods.filter((p) => p.AuthorizationType === 'COGNITO_USER_POOLS').length).toBeGreaterThanOrEqual(
      PROTECTED_ROUTES.length,
    );
  });

  it('passes the demo role switcher flag to the API and allows the X-Active-Role header in CORS', () => {
    api.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ DEMO_ROLE_SWITCHER: 'true' }) },
    });
    const options = Object.values(api.findResources('AWS::ApiGateway::Method')).filter(
      (m) => (m as { Properties: { HttpMethod: string } }).Properties.HttpMethod === 'OPTIONS',
    );
    expect(options.length).toBeGreaterThan(0);
    for (const m of options) {
      const headers = JSON.stringify(m);
      expect(headers).toContain('X-Active-Role');
    }
  });

  it('restricts the CORS preflight to the SPA origins (custom domain + CloudFront domain)', () => {
    const options = Object.values(api.findResources('AWS::ApiGateway::Method')).filter(
      (m) => (m as { Properties: { HttpMethod: string } }).Properties.HttpMethod === 'OPTIONS',
    );
    expect(options.length).toBeGreaterThan(0);
    for (const m of options) {
      const json = JSON.stringify(m);
      expect(json).not.toContain("'*'");
      expect(json).toContain(`'https://${DOMAIN}'`);
      expect(json).toMatch(/SpaDistribution.*DomainName/);
    }
  });

  it('passes the same origin allowlist to the function (CORS_ALLOWED_ORIGINS)', () => {
    api.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          CORS_ALLOWED_ORIGINS: {
            'Fn::Join': [',', [`https://${DOMAIN}`, Match.objectLike({ 'Fn::Join': Match.anyValue() })]],
          },
        }),
      },
    });
  });

  it('allows any origin when no allowlist is given', () => {
    const app = new App();
    const config = withoutDomainOrEmail();
    const auth = new AuthStack(app, 'Test-Auth-Cors', { config, relyingPartyId: 'x.example.com' });
    const t = Template.fromStack(new ApiStack(app, 'Test-Api-Cors', { config, userPool: auth.userPool }));
    t.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ CORS_ALLOWED_ORIGINS: '*' }) },
    });
    expect(JSON.stringify(t.findResources('AWS::ApiGateway::Method'))).toContain("'*'");
  });

  it('fails synth with a clear message when the API bundle has not been built', () => {
    const app = new App();
    expect(
      () =>
        new ApiStack(app, 'Test-Api-NoBundle', {
          config: withDomain(),
          userPool: new AuthStack(app, 'Test-Auth-ForNoBundle', {
            config: withDomain(),
            relyingPartyId: 'lanewise.example.com',
          }).userPool,
          apiBundleDir: path.join(os.tmpdir(), 'lanewise-missing-bundle'),
        }),
    ).toThrowError(/API bundle not found/);
  });
});

describe('auth stack (task 7)', () => {
  const { auth, authStack } = synth();

  it('creates one Cognito user pool on the Essentials tier with passkey (WebAuthn) sign-in', () => {
    auth.resourceCountIs('AWS::Cognito::UserPool', 1);
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: 'lanewise-prod-users',
      UserPoolTier: 'ESSENTIALS',
      WebAuthnRelyingPartyID: Match.anyValue(),
      WebAuthnUserVerification: 'required',
      Policies: Match.objectLike({
        SignInPolicy: { AllowedFirstAuthFactors: Match.arrayWith(['WEB_AUTHN']) },
      }),
    });
  });

  it('binds passkeys to the custom domain in prod (relying party id)', () => {
    auth.hasResourceProperties('AWS::Cognito::UserPool', { WebAuthnRelyingPartyID: DOMAIN });
    auth.hasOutput('RelyingPartyId', { Value: DOMAIN });
  });

  it('sends one-time codes through SES from noreply@1cloudhub.com and enables EMAIL_OTP in prod', () => {
    expect(authStack.allowedFirstAuthFactors).toEqual(['PASSWORD', 'WEB_AUTHN', 'EMAIL_OTP']);
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      EmailConfiguration: {
        EmailSendingAccount: 'DEVELOPER',
        From: 'LaneWise <noreply@1cloudhub.com>',
        SourceArn: Match.anyValue(),
      },
      Policies: Match.objectLike({
        SignInPolicy: { AllowedFirstAuthFactors: ['PASSWORD', 'WEB_AUTHN', 'EMAIL_OTP'] },
      }),
    });
    const pool = Object.values(auth.findResources('AWS::Cognito::UserPool'))[0] as {
      Properties: { EmailConfiguration: { SourceArn: unknown } };
    };
    // arn:<partition>:ses:us-east-1:<account>:identity/1cloudhub.com
    expect(JSON.stringify(pool.Properties.EmailConfiguration.SourceArn)).toMatch(/:ses:us-east-1:.*:identity\/1cloudhub\.com/);
    auth.hasOutput('EmailOtpEnabled', { Value: 'true' });
    const warnings = Annotations.fromStack(authStack).findWarning('*', Match.stringLikeRegexp('Email one-time codes'));
    expect(warnings).toHaveLength(0);
  });

  it('binds passkeys to the CloudFront domain when no custom domain is configured', () => {
    const app = new App();
    const config = withoutDomainOrEmail();
    const spa = new SpaHostingStack(app, 'Test-Spa-Rp', { config });
    const stack = new AuthStack(app, 'Test-Auth-Rp', {
      config,
      relyingPartyId: config.auth.relyingPartyId ?? config.domainName ?? spa.distribution.distributionDomainName,
    });
    const pool = Object.values(Template.fromStack(stack).findResources('AWS::Cognito::UserPool'))[0] as {
      Properties: { WebAuthnRelyingPartyID: unknown };
    };
    expect(JSON.stringify(pool.Properties.WebAuthnRelyingPartyID)).toMatch(/SpaDistribution/);
  });

  it('keeps email OTP off (with a synth warning) when no SES identity is configured', () => {
    const stack = new AuthStack(new App(), 'Test-Auth-NoSes', {
      config: withoutDomainOrEmail(),
      relyingPartyId: 'x.example.com',
    });
    expect(stack.allowedFirstAuthFactors).toEqual(['PASSWORD', 'WEB_AUTHN']);
    const warnings = Annotations.fromStack(stack).findWarning('*', Match.stringLikeRegexp('Email one-time codes are OFF'));
    expect(warnings).toHaveLength(1);
  });

  it('enables email OTP (sent through SES) when an SES identity is configured', () => {
    const app = new App();
    const base = withDomain();
    const config = {
      ...base,
      auth: {
        ...base.auth,
        email: { fromEmail: 'no-reply@lanewise.smretail.com', sesRegion: 'ap-southeast-1' },
      },
    };
    const stack = new AuthStack(app, 'Test-Auth-Ses', { config, relyingPartyId: 'lanewise.smretail.com' });
    const t = Template.fromStack(stack);
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      WebAuthnRelyingPartyID: 'lanewise.smretail.com',
      Policies: Match.objectLike({
        SignInPolicy: { AllowedFirstAuthFactors: ['PASSWORD', 'WEB_AUTHN', 'EMAIL_OTP'] },
      }),
      EmailConfiguration: Match.objectLike({ EmailSendingAccount: 'DEVELOPER' }),
    });
  });

  it('closes the password paths: no forgot-password recovery, max-strength policy, no MFA', () => {
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      AccountRecoverySetting: { RecoveryMechanisms: [{ Name: 'admin_only', Priority: 1 }] },
      Policies: Match.objectLike({ PasswordPolicy: Match.objectLike({ MinimumLength: 99 }) }),
      MfaConfiguration: 'OFF',
    });
  });

  it('uses email as a case-insensitive, immutable, auto-verified username (P13)', () => {
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      UsernameAttributes: ['email'],
      UsernameConfiguration: { CaseSensitive: false },
      AutoVerifiedAttributes: ['email'],
      Schema: Match.arrayWith([Match.objectLike({ Name: 'email', Mutable: false, Required: true })]),
    });
  });

  it('allows self sign-up in demo mode', () => {
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
    });
  });

  it('wires the pre-sign-up allowlist trigger to the bundled Lambda', () => {
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: { PreSignUp: { 'Fn::GetAtt': [Match.stringLikeRegexp('PreSignUpFunction'), 'Arn'] } },
    });
    auth.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'lanewise-prod-pre-sign-up',
      Runtime: 'nodejs20.x',
      Handler: 'index.handler',
      Environment: { Variables: Match.objectLike({ SELF_SIGN_UP_ENABLED: 'true' }) },
    });
    auth.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'cognito-idp.amazonaws.com',
    });
  });

  it('retains the prod user pool with deletion protection', () => {
    auth.hasResource('AWS::Cognito::UserPool', { DeletionPolicy: 'Retain' });
    auth.hasResourceProperties('AWS::Cognito::UserPool', { DeletionProtection: 'ACTIVE' });
  });

  it('gives the SPA a public client limited to choice-based sign-in and refresh', () => {
    auth.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
    auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      ExplicitAuthFlows: ['ALLOW_USER_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      PreventUserExistenceErrors: 'ENABLED',
      EnableTokenRevocation: true,
      WriteAttributes: ['email'],
    });
  });

  it('matches token lifetimes to the 60-minute idle timeout (requirement 1.8)', () => {
    expect(TOKEN_POLICY.accessTokenMinutes).toBe(60);
    auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      AccessTokenValidity: 60,
      IdTokenValidity: 60,
      RefreshTokenValidity: TOKEN_POLICY.refreshTokenHours * 60,
      TokenValidityUnits: { AccessToken: 'minutes', IdToken: 'minutes', RefreshToken: 'minutes' },
      AuthSessionValidity: TOKEN_POLICY.authSessionMinutes,
    });
  });

  it('fails synth with a clear message when the pre-sign-up bundle has not been built', () => {
    expect(
      () =>
        new AuthStack(new App(), 'Test-Auth-NoBundle', {
          config: withDomain(),
          relyingPartyId: 'x.example.com',
          preSignUpBundleDir: path.join(os.tmpdir(), 'lanewise-missing-bundle'),
        }),
    ).toThrowError(/Pre-sign-up bundle not found/);
  });
});

describe('pre-sign-up bundle (built /api output)', () => {
  it('rejects outside domains and accepts allowlisted ones from the bundle deployed by the stack', async () => {
    const mod = (await import(pathToFileURL(path.join(DEFAULT_PRE_SIGN_UP_BUNDLE_DIR, 'index.mjs')).href)) as {
      handler: (event: unknown) => Promise<unknown>;
    };
    const ev = (email: string) => ({
      triggerSource: 'PreSignUp_AdminCreateUser',
      request: { userAttributes: { email } },
      response: {},
    });
    await expect(mod.handler(ev('juan@smretail.com.evil.io'))).rejects.toThrow("This work email domain isn't allowed.");
    await expect(mod.handler(ev('juan@smretail.com'))).resolves.toBeDefined();
  });
});

describe('API service bundle (built /api output)', () => {
  it('serves the /health contract from the bundle deployed by the stack', async () => {
    const bundle = path.join(DEFAULT_API_BUNDLE_DIR, 'index.mjs');
    const mod = (await import(pathToFileURL(bundle).href)) as {
      handler: (
        event: unknown,
        context: unknown,
      ) => Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;
    };
    const res = await mod.handler(
      { httpMethod: 'GET', path: '/health', headers: {}, body: null, requestContext: { requestId: 't' } },
      { awsRequestId: 't' },
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toMatch(/^application\/json/);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['env', 'service', 'status', 'time']);
    expect(body).toMatchObject({ status: 'ok', service: 'lanewise-api' });
    expect(Number.isNaN(Date.parse(body.time as string))).toBe(false);
  });
});

describe('pipeline IAM stack', () => {
  const { pipelineIam } = synth();

  it('creates a single CodeStar GitHub connection (created pending)', () => {
    pipelineIam.resourceCountIs('AWS::CodeStarConnections::Connection', 1);
    pipelineIam.hasResourceProperties('AWS::CodeStarConnections::Connection', {
      ConnectionName: 'lanewise-prod-github',
      ProviderType: 'GitHub',
    });
  });

  it('creates scoped CodePipeline and CodeBuild service roles', () => {
    pipelineIam.resourceCountIs('AWS::IAM::Role', 2);
    pipelineIam.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: { Service: 'codepipeline.amazonaws.com' },
          },
        ],
      },
    });
    pipelineIam.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: { Service: 'codebuild.amazonaws.com' },
          },
        ],
      },
    });
  });

  it('grants no wildcard-resource admin (least privilege)', () => {
    // No statement should combine "*" action with "*" resource.
    const policies = pipelineIam.findResources('AWS::IAM::Policy');
    for (const policy of Object.values(policies)) {
      const statements = (policy as {
        Properties: { PolicyDocument: { Statement: Array<{ Action: unknown; Resource: unknown }> } };
      }).Properties.PolicyDocument.Statement;
      for (const stmt of statements) {
        const isStarAction = stmt.Action === '*';
        const isStarResource = stmt.Resource === '*';
        expect(isStarAction && isStarResource).toBe(false);
      }
    }
  });

  it('scopes the pipeline source grant to the created connection only', () => {
    pipelineIam.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'codestar-connections:UseConnection',
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });
});

describe('PR checks pipeline stack', () => {
  const { pipelinePrChecks, prChecksStack } = synth();

  it('creates a single CodeBuild project named for PR checks', () => {
    pipelinePrChecks.resourceCountIs('AWS::CodeBuild::Project', 1);
    pipelinePrChecks.hasResourceProperties('AWS::CodeBuild::Project', {
      Name: 'lanewise-prod-pr-checks',
      Source: Match.objectLike({
        Type: 'GITHUB',
        ReportBuildStatus: true,
        Location: Match.stringLikeRegexp('SM-CashierManagement'),
        BuildSpec: 'infra/buildspec-pr.yml',
      }),
    });
  });

  it('triggers on pull-request events against the tracked branch via a webhook filter', () => {
    pipelinePrChecks.hasResourceProperties('AWS::CodeBuild::Project', {
      Triggers: Match.objectLike({
        Webhook: true,
        FilterGroups: [
          Match.arrayWith([
            Match.objectLike({
              Type: 'EVENT',
              Pattern: 'PULL_REQUEST_CREATED, PULL_REQUEST_UPDATED, PULL_REQUEST_REOPENED',
            }),
            Match.objectLike({
              Type: 'BASE_REF',
              Pattern: Match.stringLikeRegexp('main'),
            }),
          ]),
        ],
      }),
    });
  });

  it('reuses the CodeBuild role instead of creating a new one', () => {
    // The role lives in PipelineIamStack; the PR-checks stack must not define its own.
    pipelinePrChecks.resourceCountIs('AWS::IAM::Role', 0);
  });

  it('exposes the branch-protection status-check context name', () => {
    // Region resolves to a token at synth time; the context format is asserted here.
    expect(prChecksStack.statusCheckContext).toContain('AWS CodeBuild');
    expect(prChecksStack.statusCheckContext).toContain('lanewise-prod-pr-checks');
    expect(prChecksStack.projectName).toBe('lanewise-prod-pr-checks');
  });
});

describe('deploy pipeline stack', () => {
  const { deployPipeline, deployPipelineStack } = synth();

  it('creates a single CodePipeline named for the prod deploy', () => {
    deployPipeline.resourceCountIs('AWS::CodePipeline::Pipeline', 1);
    deployPipeline.hasResourceProperties('AWS::CodePipeline::Pipeline', {
      Name: 'lanewise-prod-deploy',
    });
    expect(deployPipelineStack.pipelineName).toBe('lanewise-prod-deploy');
  });

  it('wires Source -> Build -> Deploy-Prod stages in order', () => {
    const pipelines = deployPipeline.findResources('AWS::CodePipeline::Pipeline');
    const pipeline = Object.values(pipelines)[0] as {
      Properties: { Stages: Array<{ Name: string }> };
    };
    const stageNames = pipeline.Properties.Stages.map((s) => s.Name);
    expect(stageNames).toEqual(['Source', 'Build', 'Deploy-Prod']);
  });

  it('sources main from the CodeStar connection', () => {
    deployPipeline.hasResourceProperties('AWS::CodePipeline::Pipeline', {
      Stages: Match.arrayWith([
        Match.objectLike({
          Name: 'Source',
          Actions: Match.arrayWith([
            Match.objectLike({
              ActionTypeId: Match.objectLike({
                Category: 'Source',
                Provider: 'CodeStarSourceConnection',
              }),
              Configuration: Match.objectLike({
                FullRepositoryId: '1CloudHub/SM-CashierManagement',
                BranchName: 'main',
              }),
            }),
          ]),
        }),
      ]),
    });
  });

  it('builds the SPA + API and deploys via CodeBuild projects', () => {
    // Two CodeBuild projects: the build project and the cdk-deploy project.
    deployPipeline.resourceCountIs('AWS::CodeBuild::Project', 2);
    deployPipeline.hasResourceProperties('AWS::CodeBuild::Project', {
      Name: 'lanewise-prod-build',
      Source: Match.objectLike({ BuildSpec: 'infra/buildspec-deploy.yml' }),
    });
    deployPipeline.hasResourceProperties('AWS::CodeBuild::Project', {
      Name: 'lanewise-prod-deploy-cdk',
      Source: Match.objectLike({ BuildSpec: 'infra/buildspec-cdk-deploy.yml' }),
    });
    expect(deployPipelineStack.buildProjectName).toBe('lanewise-prod-build');
    expect(deployPipelineStack.deployProjectName).toBe('lanewise-prod-deploy-cdk');
  });

  it('runs both CodeBuild projects under the shared imported CodeBuild role', () => {
    // The Build and Deploy projects must reuse the CodeBuild role from
    // PipelineIamStack (imported), not define their own service role. CodePipeline
    // still creates its own per-action wiring roles — that is standard L2 behaviour
    // — so we assert the CodeBuild projects' ServiceRole is the imported ARN.
    const projects = deployPipeline.findResources('AWS::CodeBuild::Project');
    const projectValues = Object.values(projects) as Array<{
      Properties: { ServiceRole: { 'Fn::ImportValue': string } };
    }>;
    expect(projectValues).toHaveLength(2);
    for (const project of projectValues) {
      const serviceRole = project.Properties.ServiceRole;
      expect(serviceRole['Fn::ImportValue']).toContain('PipelineIam');
      expect(serviceRole['Fn::ImportValue']).toContain('CodeBuildRole');
    }
  });

  it('provisions an encrypted, private, disposable artifact bucket', () => {
    deployPipeline.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('runs every action under the pipeline role (no per-action roles to assume)', () => {
    const pipelines = deployPipeline.findResources('AWS::CodePipeline::Pipeline');
    const pipeline = Object.values(pipelines)[0] as {
      Properties: { RoleArn: unknown; Stages: Array<{ Actions: Array<{ RoleArn?: unknown }> }> };
    };
    const actions = pipeline.Properties.Stages.flatMap((s) => s.Actions);
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(action.RoleArn).toEqual(pipeline.Properties.RoleArn);
    }
  });

  it('grants the imported roles artifact access via the bucket policy', () => {
    deployPipeline.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Sid: 'PipelineAndBuildArtifacts', Effect: 'Allow' }),
        ]),
      },
    });
  });
});

describe('CodeBuild role deploy grants', () => {
  const { pipelineIam } = synth();

  it('can read LaneWise stack outputs and invalidate CloudFront for the deploy', () => {
    // The deploy build reads stack outputs, syncs the SPA to S3 and invalidates
    // CloudFront under the shared CodeBuild role (task 3.4 / DEP-003).
    pipelineIam.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'cloudformation:DescribeStacks', Effect: 'Allow' }),
          Match.objectLike({ Action: 'cloudfront:CreateInvalidation', Effect: 'Allow' }),
        ]),
      },
    });
  });
});

describe('environment config', () => {
  it('defaults to prod and rejects unknown environments', () => {
    expect(resolveEnvironment(undefined).envName).toBe('prod');
    expect(() => resolveEnvironment('staging')).toThrowError(/Unknown environment/);
  });
});
