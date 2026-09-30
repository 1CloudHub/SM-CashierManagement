import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { describe, expect, it } from 'vitest';
import { resolveEnvironment } from '../config/environments';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { IngestionStorage } from '../lib/ingestion-storage';

interface Statement {
  Effect: string;
  Action: string | string[];
  Resource: unknown;
  Condition?: unknown;
}

function standalone(opts: { retainData: boolean; allowedOrigins?: string[] }) {
  const app = new App();
  const stack = new Stack(app, 'Test-Ingestion');
  const fn = new lambda.Function(stack, 'Fn', {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => ({});'),
  });
  const storage = new IngestionStorage(stack, 'IngestionStorage', {
    envName: 'prod',
    retainData: opts.retainData,
    apiFunction: fn,
    allowedOrigins: opts.allowedOrigins,
  });
  return { template: Template.fromStack(stack), stack, storage };
}

function iamStatements(template: Template): Statement[] {
  const policies = template.findResources('AWS::IAM::Policy');
  return Object.values(policies).flatMap(
    (p) => (p as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties.PolicyDocument.Statement,
  );
}

function actionsOf(s: Statement): string[] {
  return Array.isArray(s.Action) ? s.Action : [s.Action];
}

describe('IngestionStorage construct (task 9.1)', () => {
  const { template, stack, storage } = standalone({ retainData: true });

  it('creates exactly one private bucket with all public access blocked', () => {
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
    });
  });

  it('encrypts at rest (S3-managed) and versions objects', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
      },
      VersioningConfiguration: { Status: 'Enabled' },
    });
  });

  it('enforces SSL via a bucket policy denying non-TLS requests', () => {
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny',
            Action: 's3:*',
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
        ]),
      },
    });
  });

  it('allows browser presigned PUT (and GET/HEAD) via CORS, exposing ETag', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: {
        CorsRules: [
          Match.objectLike({
            AllowedMethods: Match.arrayWith(['PUT', 'GET', 'HEAD']),
            AllowedOrigins: ['*'],
            AllowedHeaders: Match.arrayWith(['content-type', 'content-length']),
            ExposedHeaders: ['ETag'],
            MaxAge: Match.anyValue(),
          }),
        ],
      },
    });
  });

  it('restricts CORS to the configured origins when given', () => {
    const { template: t } = standalone({ retainData: true, allowedOrigins: ['https://app.example.com'] });
    t.hasResourceProperties('AWS::S3::Bucket', {
      CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedOrigins: ['https://app.example.com'] })] },
    });
  });

  it('expires raw uploads/ after 365 days, aborts stale multipart uploads, expires noncurrent versions', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ Prefix: 'uploads/', ExpirationInDays: 365, Status: 'Enabled' }),
          Match.objectLike({ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }),
          Match.objectLike({ NoncurrentVersionExpiration: { NoncurrentDays: 30 } }),
        ]),
      },
    });
  });

  it('never expires current objects outside uploads/ (snapshots/ are kept)', () => {
    const bucket = Object.values(template.findResources('AWS::S3::Bucket'))[0] as {
      Properties: { LifecycleConfiguration: { Rules: Array<Record<string, unknown>> } };
    };
    const expiring = bucket.Properties.LifecycleConfiguration.Rules.filter(
      (r) => r.ExpirationInDays !== undefined || r.ExpirationDate !== undefined,
    );
    expect(expiring).toHaveLength(1);
    expect(expiring[0].Prefix).toBe('uploads/');
    for (const r of bucket.Properties.LifecycleConfiguration.Rules) {
      expect(r.Prefix).not.toBe('snapshots/');
    }
  });

  it('retains the bucket when retainData is set, with no auto-delete custom resource', () => {
    template.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain', UpdateReplacePolicy: 'Retain' });
    template.resourceCountIs('Custom::S3AutoDeleteObjects', 0);
  });

  it('destroys and auto-empties the bucket when data is not retained', () => {
    const { template: t } = standalone({ retainData: false });
    t.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Delete' });
    t.resourceCountIs('Custom::S3AutoDeleteObjects', 1);
  });

  it('sets INGESTION_BUCKET on the API function to the bucket name', () => {
    const bucketLogicalId = stack.getLogicalId(storage.bucket.node.defaultChild as never);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: { INGESTION_BUCKET: { Ref: bucketLogicalId } } },
    });
  });

  it('grants the API only s3:PutObject/s3:GetObject on uploads/* and snapshots/*, list on uploads/ only, no delete', () => {
    const s3Statements = iamStatements(template).filter((s) => actionsOf(s).some((a) => a.startsWith('s3:')));
    expect(s3Statements).toHaveLength(2);
    const stmt = s3Statements.find((s) => actionsOf(s).includes('s3:GetObject')) as Statement;
    const list = s3Statements.find((s) => actionsOf(s).includes('s3:ListBucket')) as Statement;
    expect(actionsOf(list)).toEqual(['s3:ListBucket']);
    expect(JSON.stringify(list)).toContain('"s3:prefix":["uploads/*"]');
    expect(stmt.Effect).toBe('Allow');
    expect([...actionsOf(stmt)].sort()).toEqual(['s3:GetObject', 's3:PutObject']);
    const resources = JSON.stringify(stmt.Resource);
    expect(resources).toContain('/uploads/*');
    expect(resources).toContain('/snapshots/*');
    expect((stmt.Resource as unknown[]).length).toBe(2);

    const allActions = iamStatements(template).flatMap(actionsOf);
    expect(allActions.some((a) => /^s3:Delete/.test(a))).toBe(false);
    expect(allActions).not.toContain('s3:*');
  });
});

describe('API stack wires ingestion storage', () => {
  const app = new App();
  const config = resolveEnvironment('prod');
  const auth = new AuthStack(app, 'Test-Auth-Ingestion', { config, relyingPartyId: 'lanewise.example.com' });
  const api = Template.fromStack(new ApiStack(app, 'Test-Api-Ingestion', { config, userPool: auth.userPool }));

  it('adds a retained ingestion bucket and passes its name to the API function', () => {
    api.resourceCountIs('AWS::S3::Bucket', 1);
    api.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain' });
    api.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'lanewise-prod-api',
      Environment: { Variables: Match.objectLike({ INGESTION_BUCKET: { Ref: Match.anyValue() } }) },
    });
  });

  it('outputs the ingestion bucket name', () => {
    api.hasOutput('IngestionBucketName', { Value: { Ref: Match.anyValue() } });
  });
});
