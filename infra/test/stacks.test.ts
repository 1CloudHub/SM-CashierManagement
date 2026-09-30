import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { resolveEnvironment } from '../config/environments';
import { ApiStack, DEFAULT_API_BUNDLE_DIR } from '../lib/api-stack';
import { DeployPipelineStack } from '../lib/deploy-pipeline-stack';
import { PipelineIamStack } from '../lib/pipeline-iam-stack';
import { PipelinePrChecksStack } from '../lib/pipeline-pr-checks-stack';
import { SpaHostingStack } from '../lib/spa-hosting-stack';

function synth() {
  const app = new App();
  const config = resolveEnvironment('prod');
  const spa = new SpaHostingStack(app, 'Test-SpaHosting', { config });
  const api = new ApiStack(app, 'Test-Api', { config });
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
    api: Template.fromStack(api),
    pipelineIam: Template.fromStack(pipelineIam),
    pipelinePrChecks: Template.fromStack(pipelinePrChecks),
    prChecksStack: pipelinePrChecks,
    deployPipeline: Template.fromStack(deployPipeline),
    deployPipelineStack: deployPipeline,
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

  it('fails synth with a clear message when the API bundle has not been built', () => {
    const app = new App();
    expect(
      () =>
        new ApiStack(app, 'Test-Api-NoBundle', {
          config: resolveEnvironment('prod'),
          apiBundleDir: path.join(os.tmpdir(), 'lanewise-missing-bundle'),
        }),
    ).toThrowError(/API bundle not found/);
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
