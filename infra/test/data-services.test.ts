import * as os from 'node:os';
import * as path from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { resolveEnvironment, type EnvironmentConfig } from '../config/environments';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { DataStack } from '../lib/data-stack';
import { JobsStack } from '../lib/jobs-stack';
import { LocationStack } from '../lib/location-stack';
import { grantSesSend, sesEnvironment } from '../lib/notifications';

/** Mirrors the task-24 wiring in lib/lanewise-app.ts. */
function synth(config: EnvironmentConfig = resolveEnvironment('prod')) {
  const app = new App();
  const auth = new AuthStack(app, 'Test-Auth', { config, relyingPartyId: 'example.cloudfront.net' });
  const data = new DataStack(app, 'Test-Data', { config, uploadCorsOrigins: ['https://example.cloudfront.net'] });
  const jobs = new JobsStack(app, 'Test-Jobs', {
    config,
    vpc: data.vpc,
    appSubnets: data.appSubnets,
    appSecurityGroup: data.appSecurityGroup,
    dbSecret: data.dbSecret,
    dbEnvironment: data.dbEnvironment,
  });
  const location = new LocationStack(app, 'Test-Location', { config });
  const api = new ApiStack(app, 'Test-Api', {
    config,
    userPool: auth.userPool,
    network: { vpc: data.vpc, subnets: data.appSubnets, securityGroups: [data.appSecurityGroup] },
    serviceEnvironment: {
      ...data.dbEnvironment,
      UPLOADS_BUCKET: data.uploadsBucket.bucketName,
      JOBS_QUEUE_URL: jobs.queue.queueUrl,
      LOCATION_MAP_NAME: location.mapName,
      LOCATION_ROUTE_CALCULATOR: location.routeCalculatorName,
      ...sesEnvironment(data, config.notifications),
    },
  });
  data.dbSecret.grantRead(api.apiFunction);
  data.uploadsBucket.grantPut(api.apiFunction);
  data.uploadsBucket.grantRead(api.apiFunction);
  jobs.queue.grantSendMessages(api.apiFunction);
  location.grantMap(api.apiFunction);
  location.grantRoutes(api.apiFunction);
  grantSesSend(api, api.apiFunction, config.notifications);
  location.grantRoutes(jobs.worker);
  grantSesSend(jobs, jobs.worker, config.notifications);
  return {
    data: Template.fromStack(data),
    jobs: Template.fromStack(jobs),
    location: Template.fromStack(location),
    api: Template.fromStack(api),
  };
}

type Statement = { Action: string | string[]; Resource: unknown; Condition?: unknown };

function statements(template: Template): Statement[] {
  return Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
    (p) => (p as { Properties: { PolicyDocument: { Statement: Statement[] } } }).Properties.PolicyDocument.Statement,
  );
}

function actionsOf(s: Statement): string[] {
  return Array.isArray(s.Action) ? s.Action : [s.Action];
}

const prod = resolveEnvironment('prod');
const { data, jobs, location, api } = synth();

describe('Data stack — network', () => {
  it('uses isolated subnets only: no internet or NAT gateway', () => {
    data.resourceCountIs('AWS::EC2::VPC', 1);
    data.resourceCountIs('AWS::EC2::InternetGateway', 0);
    data.resourceCountIs('AWS::EC2::NatGateway', 0);
    data.resourceCountIs('AWS::EC2::Subnet', 2);
    data.allResourcesProperties('AWS::EC2::Subnet', { MapPublicIpOnLaunch: false });
  });

  it('adds the S3 gateway endpoint and the configured interface endpoints with private DNS', () => {
    data.hasResourceProperties('AWS::EC2::VPCEndpoint', { VpcEndpointType: 'Gateway' });
    for (const name of prod.data.interfaceEndpoints) {
      data.hasResourceProperties('AWS::EC2::VPCEndpoint', {
        VpcEndpointType: 'Interface',
        PrivateDnsEnabled: true,
        ServiceName: Match.objectLike({ 'Fn::Join': ['', Match.arrayWith([`.${name}`])] }),
      });
    }
  });

  it('resolves availability zones at deploy time (no synth-time lookup)', () => {
    data.hasResourceProperties('AWS::EC2::Subnet', {
      AvailabilityZone: { 'Fn::Select': [0, { 'Fn::GetAZs': '' }] },
    });
  });

  it('switches functions to private-with-egress subnets when NAT is configured', () => {
    const withNat = synth({ ...prod, data: { ...prod.data, natGateways: 1 } }).data;
    withNat.resourceCountIs('AWS::EC2::NatGateway', 1);
    withNat.resourceCountIs('AWS::EC2::Subnet', 6);
  });
});

describe('Data stack — Aurora PostgreSQL', () => {
  it('runs Aurora PostgreSQL 16 Serverless v2 at the configured capacity', () => {
    data.hasResourceProperties('AWS::RDS::DBCluster', {
      Engine: 'aurora-postgresql',
      EngineVersion: '16.4',
      DatabaseName: 'lanewise',
      StorageEncrypted: true,
      DeletionProtection: true,
      BackupRetentionPeriod: prod.data.backupRetentionDays,
      ServerlessV2ScalingConfiguration: {
        MinCapacity: prod.data.minCapacity,
        MaxCapacity: prod.data.maxCapacity,
      },
    });
    data.hasResourceProperties('AWS::RDS::DBInstance', {
      DBInstanceClass: 'db.serverless',
      PubliclyAccessible: false,
    });
  });

  it('retains data in prod: snapshot on delete and a retained secret', () => {
    data.hasResource('AWS::RDS::DBCluster', { DeletionPolicy: 'Snapshot' });
    data.hasResource('AWS::SecretsManager::Secret', { DeletionPolicy: 'Retain' });
  });

  it('generates the credentials into Secrets Manager (no plaintext password)', () => {
    data.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'lanewise/prod/db-master',
      GenerateSecretString: Match.objectLike({ GenerateStringKey: 'password' }),
    });
    const cluster = Object.values(data.findResources('AWS::RDS::DBCluster'))[0] as {
      Properties: { MasterUserPassword: unknown };
    };
    expect(JSON.stringify(cluster.Properties.MasterUserPassword)).toContain('resolve:secretsmanager');
  });

  it('requires TLS', () => {
    data.hasResourceProperties('AWS::RDS::DBClusterParameterGroup', {
      Parameters: { 'rds.force_ssl': '1' },
    });
  });

  it('accepts PostgreSQL only from the app security group', () => {
    const ingress = Object.values(data.findResources('AWS::EC2::SecurityGroupIngress')).map(
      (r) => (r as { Properties: Record<string, unknown> }).Properties,
    );
    const pg = ingress.filter((p) => p.FromPort === 5432);
    expect(pg).toHaveLength(1);
    expect(pg[0]).toMatchObject({
      ToPort: 5432,
      SourceSecurityGroupId: { 'Fn::GetAtt': [expect.stringMatching(/^AppSecurityGroup/), 'GroupId'] },
    });
    for (const p of ingress) expect(p).not.toHaveProperty('CidrIp');
  });
});

describe('Data stack — migrations at deploy', () => {
  it('runs the bundled migrate CLI in the VPC through a CDK Trigger after the cluster', () => {
    data.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'lanewise-prod-db-migrate',
      Handler: 'runner.handler',
      Runtime: 'nodejs20.x',
      VpcConfig: Match.objectLike({ SecurityGroupIds: Match.anyValue() }),
      Environment: {
        Variables: Match.objectLike({
          DB_SECRET_ARN: Match.anyValue(),
          DB_SSL_MODE: 'verify-full',
          NODE_EXTRA_CA_CERTS: '/var/runtime/ca-cert.pem',
        }),
      },
    });
    const triggers = data.findResources('Custom::Trigger');
    expect(Object.keys(triggers)).toHaveLength(1);
    const dependsOn = (Object.values(triggers)[0] as { DependsOn: string[] }).DependsOn;
    expect(dependsOn.some((d) => d.startsWith('DatabaseB'))).toBe(true);
    expect(dependsOn.some((d) => d.startsWith('DatabaseWriter'))).toBe(true);
  });

  it('fails synth with a clear message when the migrate bundle has not been built', () => {
    const app = new App();
    expect(
      () =>
        new DataStack(app, 'NoBundle', {
          config: prod,
          uploadCorsOrigins: [],
          migrateBundleDir: path.join(os.tmpdir(), 'lanewise-no-such-bundle'),
        }),
    ).toThrow(/Migrate bundle not found/);
  });
});

describe('Data stack — uploads bucket', () => {
  it('is private, encrypted, TLS-only, versioned and retained', () => {
    data.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      VersioningConfiguration: { Status: 'Enabled' },
    });
    data.hasResource('AWS::S3::Bucket', { DeletionPolicy: 'Retain' });
    data.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
        ]),
      },
    });
  });

  it('has lifecycle rules and CORS limited to the SPA origin', () => {
    data.hasResourceProperties('AWS::S3::Bucket', {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({ AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }),
          Match.objectLike({ ExpirationInDays: prod.data.uploadRetentionDays }),
        ]),
      },
      CorsConfiguration: {
        CorsRules: [Match.objectLike({ AllowedOrigins: ['https://example.cloudfront.net'] })],
      },
    });
  });
});

describe('Jobs stack', () => {
  it('has an encrypted queue with a dead-letter queue', () => {
    jobs.resourceCountIs('AWS::SQS::Queue', 2);
    jobs.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'lanewise-prod-jobs',
      SqsManagedSseEnabled: true,
      VisibilityTimeout: prod.jobs.workerTimeoutSeconds * 6,
      RedrivePolicy: { deadLetterTargetArn: Match.anyValue(), maxReceiveCount: prod.jobs.maxReceiveCount },
    });
    jobs.hasResourceProperties('AWS::SQS::Queue', { QueueName: 'lanewise-prod-jobs-dlq', SqsManagedSseEnabled: true });
  });

  it('runs the worker in the VPC with partial batch failures and capped concurrency', () => {
    jobs.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'lanewise-prod-jobs-worker',
      VpcConfig: Match.objectLike({ SecurityGroupIds: Match.anyValue() }),
    });
    jobs.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      ScalingConfig: { MaximumConcurrency: prod.jobs.maxConcurrency },
    });
  });
});

describe('Location stack', () => {
  it('creates a map and a route calculator from config', () => {
    location.hasResourceProperties('AWS::Location::Map', {
      MapName: 'lanewise-prod-map',
      Configuration: { Style: prod.location.mapStyle },
    });
    location.hasResourceProperties('AWS::Location::RouteCalculator', {
      CalculatorName: 'lanewise-prod-routes',
      DataSource: prod.location.dataSource,
    });
  });
});

describe('API wiring (task 24)', () => {
  it('runs the API function in the VPC with the data-service settings', () => {
    api.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'lanewise-prod-api',
      VpcConfig: Match.objectLike({ SecurityGroupIds: Match.anyValue(), SubnetIds: Match.anyValue() }),
      Environment: {
        Variables: Match.objectLike({
          LANEWISE_ENV: 'prod',
          DB_SECRET_ARN: Match.anyValue(),
          DB_HOST: Match.anyValue(),
          DB_NAME: 'lanewise',
          UPLOADS_BUCKET: Match.anyValue(),
          JOBS_QUEUE_URL: Match.anyValue(),
          LOCATION_MAP_NAME: Match.anyValue(),
          LOCATION_ROUTE_CALCULATOR: Match.anyValue(),
          SES_FROM_ADDRESS: prod.notifications.fromAddress,
        }),
      },
    });
  });

  it('scopes every API grant to a specific resource (no wildcard resources)', () => {
    const all = statements(api);
    for (const s of all) expect(s.Resource).not.toBe('*');
    const has = (action: string) => all.some((s) => actionsOf(s).includes(action));
    for (const action of [
      'secretsmanager:GetSecretValue',
      's3:PutObject',
      'sqs:SendMessage',
      'geo:CalculateRouteMatrix',
      'geo:GetMapTile',
      'ses:SendEmail',
    ]) {
      expect(has(action), action).toBe(true);
    }
    // Never destructive on the uploads bucket or the queue.
    expect(has('s3:DeleteObject*')).toBe(false);
    expect(has('sqs:DeleteMessage')).toBe(false);
  });

  it('limits SES sending to the verified identity and its From addresses', () => {
    for (const template of [api, jobs]) {
      const ses = statements(template).find((s) => actionsOf(s).includes('ses:SendEmail'));
      expect(ses).toBeDefined();
      expect(JSON.stringify(ses!.Resource)).toContain(`identity/${prod.notifications.sesIdentity}`);
      expect(ses!.Condition).toEqual({ StringLike: { 'ses:FromAddress': `*@${prod.notifications.sesIdentity}` } });
    }
  });

  it('gives the worker queue consumption only on its own queue and no API-level Location map access', () => {
    const worker = statements(jobs);
    for (const s of worker) expect(s.Resource).not.toBe('*');
    expect(worker.some((s) => actionsOf(s).includes('sqs:DeleteMessage'))).toBe(true);
    expect(worker.some((s) => actionsOf(s).includes('geo:GetMapTile'))).toBe(false);
  });
});
