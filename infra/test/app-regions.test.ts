import * as fs from 'node:fs';
import * as path from 'node:path';
import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { type EnvironmentConfig, resolveEnvironment, validateRegions } from '../config/environments';
import { createLaneWiseStacks } from '../lib/lanewise-app';
// @ts-expect-error -- plain ESM helper used by the deploy buildspec (no type declarations).
import { stackRegion } from '../scripts/stack-region.mjs';

/**
 * Region split (prod): SPA hosting + CI/CD in us-east-1, the VPC-bound
 * application stacks in us-east-2 (us-east-1 hit its VPC limit), SES kept in
 * us-east-1 where the verified 1cloudhub.com identity lives.
 */
const prod = resolveEnvironment('prod');
const stacks = createLaneWiseStacks(new App(), prod);
const template = (stack: Stack) => Template.fromStack(stack);

const HOME_STACKS = ['spa', 'pipelineIam', 'pipelinePrChecks', 'deployPipeline'] as const;
const APP_STACKS = { auth: 'Auth', data: 'Data', jobs: 'Jobs', location: 'Location', api: 'Api' } as const;

type Statement = { Action: string | string[]; Resource: unknown };
function statements(t: Template): Statement[] {
  return Object.values(t.findResources('AWS::IAM::Policy')).flatMap(
    (p) => (p as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties.PolicyDocument.Statement,
  );
}
const actionsOf = (s: Statement) => (Array.isArray(s.Action) ? s.Action : [s.Action]);

describe('application region (prod)', () => {
  it('configures us-east-1 for SPA/CI-CD and us-east-2 for the application stacks', () => {
    expect(prod.region).toBe('us-east-1');
    expect(prod.appRegion).toBe('us-east-2');
  });

  it('keeps SPA hosting and the CI/CD stacks in us-east-1 with unchanged stack names', () => {
    for (const key of HOME_STACKS) {
      expect(stacks[key].region, key).toBe('us-east-1');
    }
    expect(stacks.spa.stackName).toBe('LaneWise-prod-SpaHosting');
  });

  it('deploys Auth, Data, Jobs, Location and Api to us-east-2 with unchanged stack names', () => {
    for (const [key, name] of Object.entries(APP_STACKS) as [keyof typeof APP_STACKS, string][]) {
      expect(stacks[key].region, key).toBe('us-east-2');
      expect(stacks[key].stackName).toBe(`LaneWise-prod-${name}`);
    }
  });

  it('creates the VPC endpoints for the app region', () => {
    const endpoints = template(stacks.data).findResources('AWS::EC2::VPCEndpoint');
    const services = Object.values(endpoints).map((e) => JSON.stringify((e as { Properties: { ServiceName: unknown } }).Properties.ServiceName));
    expect(services.some((s) => s.includes('com.amazonaws.us-east-2.secretsmanager'))).toBe(true);
    expect(services.join()).not.toContain('us-east-1');
  });
});

describe('cross-region references (SPA CloudFront domain -> us-east-2)', () => {
  it('writes the CloudFront domain to SSM in us-east-2 from the SpaHosting stack', () => {
    const spa = template(stacks.spa);
    spa.hasResourceProperties('Custom::CrossRegionExportWriter', {
      WriterProps: Match.objectLike({ region: 'us-east-2' }),
    });
    const writer = Object.values(spa.findResources('Custom::CrossRegionExportWriter'))[0] as {
      Properties: { WriterProps: { exports: Record<string, unknown> } };
    };
    const names = Object.keys(writer.Properties.WriterProps.exports);
    for (const consumer of ['Auth', 'Data', 'Api']) {
      expect(names.some((n) => n.startsWith(`/cdk/exports/LaneWise-prod-${consumer}/`)), consumer).toBe(true);
    }
    for (const value of Object.values(writer.Properties.WriterProps.exports)) {
      expect(JSON.stringify(value)).toMatch(/SpaDistribution.*DomainName/);
    }
  });

  it('leaves the SPA bucket and CloudFront distribution as they were', () => {
    const spa = template(stacks.spa);
    spa.resourceCountIs('AWS::CloudFront::Distribution', 1);
    spa.resourceCountIs('AWS::S3::Bucket', 1);
    expect(Object.keys(spa.findResources('AWS::CloudFront::Distribution'))).toEqual(['SpaDistributionD69C39B0']);
  });

  it('reads the CloudFront domain in us-east-2 for the passkey relying party, API CORS and uploads CORS', () => {
    for (const key of ['auth', 'data', 'api'] as const) {
      template(stacks[key]).resourceCountIs('Custom::CrossRegionExportReader', 1);
    }
    const pool = Object.values(template(stacks.auth).findResources('AWS::Cognito::UserPool'))[0] as {
      Properties: { WebAuthnRelyingPartyID: unknown };
    };
    expect(JSON.stringify(pool.Properties.WebAuthnRelyingPartyID)).toContain('ExportsReader');
    template(stacks.api).hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ CORS_ALLOWED_ORIGINS: Match.objectLike({ 'Fn::Join': Match.anyValue() }) }) },
    });
    expect(JSON.stringify(template(stacks.api).toJSON())).not.toContain('Fn::ImportValue":"LaneWise-prod-SpaHosting');
  });

  it('keeps the SpaHosting export the pre-move us-east-1 Auth/Api stacks import', () => {
    template(stacks.spa).hasOutput('*', {
      Export: { Name: 'LaneWise-prod-SpaHosting:ExportsOutputFnGetAttSpaDistributionD69C39B0DomainName9D915BC3' },
    });
  });

  it('drops the legacy export once the old copies are gone', () => {
    const config: EnvironmentConfig = { ...prod, legacyAppStacksInHomeRegion: false };
    const spa = Template.fromStack(createLaneWiseStacks(new App(), config).spa);
    expect(JSON.stringify(spa.toJSON().Outputs)).not.toContain('Export');
  });

  it('uses plain same-region references when appRegion equals region', () => {
    const config: EnvironmentConfig = { ...prod, appRegion: 'us-east-1' };
    const same = createLaneWiseStacks(new App(), config);
    expect(same.auth.region).toBe('us-east-1');
    Template.fromStack(same.auth).resourceCountIs('Custom::CrossRegionExportReader', 0);
    Template.fromStack(same.spa).resourceCountIs('Custom::CrossRegionExportWriter', 0);
  });

  it('requires an explicit home region when appRegion is set', () => {
    expect(() => validateRegions({ ...prod, region: undefined })).toThrowError(/explicit region/);
  });
});

describe('SES stays in us-east-1', () => {
  it('sends Cognito email through the us-east-1 identity from the us-east-2 user pool', () => {
    const pool = Object.values(template(stacks.auth).findResources('AWS::Cognito::UserPool'))[0] as {
      Properties: { EmailConfiguration: { SourceArn: unknown; EmailSendingAccount: string } };
    };
    expect(pool.Properties.EmailConfiguration.EmailSendingAccount).toBe('DEVELOPER');
    expect(JSON.stringify(pool.Properties.EmailConfiguration.SourceArn)).toMatch(/:ses:us-east-1:.*:identity\/1cloudhub\.com/);
  });

  it('points the notifications settings and SES grants of the API and worker at us-east-1', () => {
    for (const key of ['api', 'jobs'] as const) {
      const t = template(stacks[key]);
      t.hasResourceProperties('AWS::Lambda::Function', {
        Environment: { Variables: Match.objectLike({ SES_REGION: 'us-east-1', SES_FROM_ADDRESS: 'noreply@1cloudhub.com' }) },
      });
      const ses = statements(t).find((s) => actionsOf(s).includes('ses:SendEmail'));
      expect(JSON.stringify(ses?.Resource), key).toMatch(/:ses:us-east-1:.*:identity\/1cloudhub\.com/);
    }
  });
});

describe('deploy role and buildspec across regions', () => {
  it('lets the CodeBuild role describe LaneWise stacks and read the CDK bootstrap version in both regions', () => {
    const all = statements(template(stacks.pipelineIam));
    const describeStacks = all.find((s) => actionsOf(s).includes('cloudformation:DescribeStacks'));
    const bootstrap = all.find((s) => actionsOf(s).includes('ssm:GetParameter'));
    for (const region of ['us-east-1', 'us-east-2']) {
      expect(JSON.stringify(describeStacks?.Resource)).toContain(`:cloudformation:${region}:`);
      expect(JSON.stringify(bootstrap?.Resource)).toContain(`:ssm:${region}:`);
    }
  });

  it('queries each stack in its own region and writes the app region into runtime-config.json', () => {
    const buildspec = fs.readFileSync(path.join(__dirname, '..', 'buildspec-cdk-deploy.yml'), 'utf8');
    expect(buildspec).toContain('scripts/stack-region.mjs "$SPA_STACK_NAME"');
    expect(buildspec).toContain('scripts/stack-region.mjs "$AUTH_STACK_NAME"');
    expect(buildspec).toContain('describe-stacks --region "$1"');
    expect(buildspec).not.toMatch(/describe-stacks\s+\\?\s*--stack-name/);
    expect(buildspec).toContain('region:e.APP_REGION');
  });

  it('resolves stack regions from the cloud assembly manifest', () => {
    const fake = {
      artifacts: {
        'LaneWise-prod-Auth': { type: 'aws:cloudformation:stack', environment: 'aws://123456789012/us-east-2' },
        'LaneWise-prod-SpaHosting': { type: 'aws:cloudformation:stack', environment: 'aws://unknown-account/us-east-1' },
        'Agnostic': { type: 'aws:cloudformation:stack', environment: 'aws://unknown-account/unknown-region' },
      },
    };
    expect(stackRegion(fake, 'LaneWise-prod-Auth')).toBe('us-east-2');
    expect(stackRegion(fake, 'LaneWise-prod-SpaHosting')).toBe('us-east-1');
    expect(() => stackRegion(fake, 'Agnostic')).toThrowError(/no explicit region/);
    expect(() => stackRegion(fake, 'Missing')).toThrowError(/not in the cloud assembly/);
  });
});
