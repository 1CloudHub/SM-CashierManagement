import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { type EnvironmentConfig, resolveEnvironment } from '../config/environments';
import { ATRIUM_CONTENT, AtriumStack } from '../lib/atrium-stack';
import { AuthStack } from '../lib/auth-stack';

function synth(config: EnvironmentConfig) {
  const app = new App();
  const auth = new AuthStack(app, 'Test-Auth', { config, relyingPartyId: 'prototypes.1cloudhub.com' });
  const stack = new AtriumStack(app, 'Test-Atrium', {
    config,
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
  });
  return { stack, template: Template.fromStack(stack) };
}

const prod = resolveEnvironment('prod');

describe('SM Atrium', () => {
  it('prod binds passkeys to the parent domain shared by LaneWise and Atrium', () => {
    expect(prod.auth.relyingPartyId).toBe('prototypes.1cloudhub.com');
    expect(prod.atrium?.domainName).toBe('atrium.prototypes.1cloudhub.com');
    expect(prod.atrium?.domainName.endsWith(`.${prod.auth.relyingPartyId}`)).toBe(true);
    expect(prod.domainName?.endsWith(`.${prod.auth.relyingPartyId}`)).toBe(true);
  });

  it('keeps both buckets private', () => {
    const { template } = synth(prod);
    template.resourceCountIs('AWS::S3::Bucket', 2);
    template.allResourcesProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('protects the content route with a Cognito JWT authorizer', () => {
    const { template } = synth(prod);
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      JwtConfiguration: Match.objectLike({ Audience: Match.anyValue() }),
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /content/{id}',
      AuthorizationType: 'JWT',
    });
  });

  it('passes only the known content keys to the handler', () => {
    const { template } = synth(prod);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ CONTENT_KEYS: JSON.stringify(ATRIUM_CONTENT) }) },
    });
  });

  it('serves the CloudFront domain until the atrium hosted zone is configured', () => {
    const { template, stack } = synth(prod);
    template.resourceCountIs('AWS::CertificateManager::Certificate', 0);
    expect(stack.origins).toHaveLength(1);
  });

  it('adds the custom domain once the hosted zone is set', () => {
    const config: EnvironmentConfig = {
      ...prod,
      atrium: {
        domainName: 'atrium.prototypes.1cloudhub.com',
        hostedZone: { id: 'Z0000000000000000000', name: 'atrium.prototypes.1cloudhub.com' },
      },
    };
    const { template, stack } = synth(config);
    template.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'atrium.prototypes.1cloudhub.com',
    });
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({ Aliases: ['atrium.prototypes.1cloudhub.com'] }),
    });
    expect(stack.origins[0]).toBe('https://atrium.prototypes.1cloudhub.com');
  });
});
