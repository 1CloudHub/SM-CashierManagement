import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CfnOutput, Duration, Fn, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as triggers from 'aws-cdk-lib/triggers';
import { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments';

export interface DataStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  /**
   * Directory holding the bundled migrate CLI (`index.mjs` + `migrations/`).
   * Defaults to the output of `npm run build` in `/api` (`api/dist/migrate`).
   */
  readonly migrateBundleDir?: string;
  /** Browser origins allowed to PUT/GET upload objects via pre-signed URLs. */
  readonly uploadCorsOrigins: readonly string[];
}

/** Uploads-bucket key prefix for raw ingestion files (browser → presigned PUT; task 9). */
export const UPLOADS_PREFIX = 'uploads/';
/** Uploads-bucket key prefix for normalised, immutable snapshot data pinned by scenarios (task 9). */
export const SNAPSHOTS_PREFIX = 'snapshots/';

/** Default location of the migrate CLI bundle produced by `api/scripts/bundle.mjs`. */
export const DEFAULT_MIGRATE_BUNDLE_DIR = path.join(__dirname, '..', '..', 'api', 'dist', 'migrate');

/** The deploy-time runner that wraps the migrate CLI (infra/lambda/migrate-runner). */
const MIGRATE_RUNNER = path.join(__dirname, '..', 'lambda', 'migrate-runner', 'runner.mjs');

/**
 * Lambda runtimes from Node 20 no longer load the Amazon RDS CA bundle by
 * default; this makes `sslmode=verify-full` against Aurora work.
 */
export const RDS_CA_ENV = { NODE_EXTRA_CA_CERTS: '/var/runtime/ca-cert.pem' } as const;

function assertMigrateBundle(dir: string): void {
  if (!fs.existsSync(path.join(dir, 'index.mjs')) || !fs.existsSync(path.join(dir, 'migrations'))) {
    throw new Error(
      `Migrate bundle not found at ${dir}/index.mjs (+ migrations/). Build it first: ` +
        '(cd packages/shared && npm ci && npm run build) && (cd api && npm ci && npm run build)',
    );
  }
}

/**
 * Copies the migrate CLI bundle and the runner into one asset directory, so
 * the function's code hash (and therefore the Trigger) changes whenever a
 * migration, the CLI or the runner changes.
 */
function stageMigrateAsset(bundleDir: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanewise-migrate-'));
  fs.cpSync(bundleDir, dir, { recursive: true });
  fs.copyFileSync(MIGRATE_RUNNER, path.join(dir, 'runner.mjs'));
  return dir;
}

/**
 * Network and data tier (spec task 24, ADR-0002):
 *
 *  - a VPC with **isolated** subnets only (no NAT, no internet route) and the
 *    VPC endpoints the functions need (S3 gateway + configured interface
 *    endpoints);
 *  - **Aurora PostgreSQL Serverless v2** in those subnets, encrypted, with the
 *    master credentials generated into **Secrets Manager** (never in the
 *    template), deletion protection + retained snapshots in prod;
 *  - an **application security group** — the only source the database
 *    accepts connections from; the API and job worker run in it;
 *  - a **migrations Trigger**: a Lambda in the VPC that runs the bundled
 *    migrate CLI (`api/dist/migrate`) on every deploy that changes it, after
 *    the cluster is up and before dependent stacks (API, jobs) update;
 *  - the **uploads bucket** for ingestion files (task 9).
 *
 * RDS Proxy is deliberately not used (see infra/README.md "Data services").
 */
export class DataStack extends Stack {
  public readonly vpc: ec2.Vpc;
  /** Subnets application functions run in (isolated, or private-with-egress when NAT is on). */
  public readonly appSubnets: ec2.SubnetSelection;
  /** Security group for functions that may connect to the database. */
  public readonly appSecurityGroup: ec2.SecurityGroup;
  public readonly cluster: rds.DatabaseCluster;
  /** Generated master credentials (JSON: host, port, username, password, dbname). */
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly databaseName: string;
  /** Ingestion uploads bucket (task 9). */
  public readonly uploadsBucket: s3.Bucket;
  /** Connection settings for functions in the app security group. */
  public readonly dbEnvironment: Record<string, string>;

  /**
   * Resolve AZs at deploy time (`Fn::GetAZs`) instead of a synth-time context
   * lookup, so `cdk synth` in PR checks never needs AWS credentials for it.
   */
  get availabilityZones(): string[] {
    const count = this.azCount ?? 2;
    return Array.from({ length: count }, (_, i) => Fn.select(i, Fn.getAzs()));
  }

  private readonly azCount: number;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    this.azCount = props.config.data.maxAzs;

    const { config } = props;
    const { data } = config;
    const removalPolicy = config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const bundleDir = props.migrateBundleDir ?? DEFAULT_MIGRATE_BUNDLE_DIR;
    assertMigrateBundle(bundleDir);

    // ── Network ─────────────────────────────────────────────────────────────
    const withEgress = data.natGateways > 0;
    const subnetConfiguration: ec2.SubnetConfiguration[] = [
      { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
    ];
    if (withEgress) {
      subnetConfiguration.push(
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
      );
    }
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `lanewise-${config.envName}`,
      ipAddresses: ec2.IpAddresses.cidr('10.40.0.0/16'),
      maxAzs: data.maxAzs,
      natGateways: data.natGateways,
      subnetConfiguration,
      restrictDefaultSecurityGroup: true,
    });
    const dataSubnets: ec2.SubnetSelection = { subnetGroupName: 'data' };
    this.appSubnets = withEgress ? { subnetGroupName: 'app' } : dataSubnets;

    this.appSecurityGroup = new ec2.SecurityGroup(this, 'AppSecurityGroup', {
      vpc: this.vpc,
      description: 'LaneWise functions allowed to reach the database and VPC endpoints.',
      allowAllOutbound: false,
    });

    // HTTPS egress: with no NAT the subnets have no internet route, so the
    // only reachable HTTPS targets are the S3 gateway endpoint and the
    // interface endpoints below (with NAT, AWS APIs via the NAT gateway).
    this.appSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS to AWS APIs (VPC endpoints)');
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [this.appSubnets],
    });

    const endpointSecurityGroup = new ec2.SecurityGroup(this, 'EndpointSecurityGroup', {
      vpc: this.vpc,
      description: 'LaneWise interface VPC endpoints (HTTPS from the app security group).',
      allowAllOutbound: false,
    });
    endpointSecurityGroup.addIngressRule(this.appSecurityGroup, ec2.Port.tcp(443), 'HTTPS from LaneWise functions');
    for (const name of data.interfaceEndpoints) {
      this.vpc.addInterfaceEndpoint(`Endpoint-${name.replace(/[^A-Za-z0-9]/g, '')}`, {
        service: new ec2.InterfaceVpcEndpointService(`com.amazonaws.${this.region}.${name}`, 443),
        privateDnsEnabled: true,
        subnets: this.appSubnets,
        securityGroups: [endpointSecurityGroup],
        open: false,
      });
    }

    // ── Aurora PostgreSQL Serverless v2 ─────────────────────────────────────
    this.databaseName = data.databaseName;
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: this.vpc,
      description: 'LaneWise Aurora PostgreSQL (ingress from the app security group only).',
      allowAllOutbound: false,
    });
    // Generated credentials (never in the template); kept with the retained
    // snapshot in prod so the snapshot stays usable. No fixed secretName: a
    // retained secret from a failed or deleted stack would otherwise block the
    // next create ("already exists"). Consumers use the secret ARN.
    const masterSecret = new rds.DatabaseSecret(this, 'DatabaseSecret', {
      username: 'lanewise_admin',
    });
    masterSecret.applyRemovalPolicy(removalPolicy);
    // 16.4 is no longer offered for new clusters in us-east-1; pin a current
    // minor explicitly (the CDK enum lags RDS's supported-version list).
    const engine = rds.DatabaseClusterEngine.auroraPostgres({
      version: rds.AuroraPostgresEngineVersion.of('16.8', '16'),
    });
    this.cluster = new rds.DatabaseCluster(this, 'Database', {
      engine,
      credentials: rds.Credentials.fromSecret(masterSecret),
      defaultDatabaseName: data.databaseName,
      writer: rds.ClusterInstance.serverlessV2('Writer', { publiclyAccessible: false }),
      serverlessV2MinCapacity: data.minCapacity,
      serverlessV2MaxCapacity: data.maxCapacity,
      vpc: this.vpc,
      vpcSubnets: dataSubnets,
      securityGroups: [dbSecurityGroup],
      storageEncrypted: true,
      iamAuthentication: false,
      backup: { retention: Duration.days(data.backupRetentionDays) },
      deletionProtection: config.retainData,
      removalPolicy: config.retainData ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: logs.RetentionDays.THREE_MONTHS,
      parameterGroup: new rds.ParameterGroup(this, 'DatabaseParameters', {
        engine,
        description: 'LaneWise Aurora PostgreSQL: TLS required.',
        parameters: { 'rds.force_ssl': '1' },
      }),
    });
    this.dbSecret = this.cluster.secret!;
    dbSecurityGroup.addIngressRule(this.appSecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL from LaneWise functions');
    this.appSecurityGroup.addEgressRule(dbSecurityGroup, ec2.Port.tcp(5432), 'PostgreSQL to Aurora');

    this.dbEnvironment = {
      DB_SECRET_ARN: this.dbSecret.secretArn,
      DB_HOST: this.cluster.clusterEndpoint.hostname,
      DB_PORT: '5432',
      DB_NAME: data.databaseName,
      DB_SSL_MODE: 'verify-full',
      ...RDS_CA_ENV,
    };

    // ── Migrations at deploy (Trigger) ──────────────────────────────────────
    // Runs `api/dist/migrate` inside the VPC once the writer is available. The
    // migrate CLI is forward-only, checksummed and takes an advisory lock, so
    // re-runs are no-ops and concurrent deploys are serialised. A failure
    // fails the stack deploy (and CodePipeline), before the API is updated.
    const migrateLogs = new logs.LogGroup(this, 'MigrateFunctionLogs', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy,
    });
    const migrateFn = new lambda.Function(this, 'MigrateFunction', {
      functionName: `lanewise-${config.envName}-db-migrate`,
      description: 'LaneWise deploy-time database migrations (api/dist/migrate).',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'runner.handler',
      code: lambda.Code.fromAsset(stageMigrateAsset(bundleDir)),
      timeout: Duration.minutes(5),
      memorySize: 256,
      logGroup: migrateLogs,
      vpc: this.vpc,
      vpcSubnets: this.appSubnets,
      securityGroups: [this.appSecurityGroup],
      environment: {
        LANEWISE_ENV: config.envName,
        ...this.dbEnvironment,
      },
    });
    this.dbSecret.grantRead(migrateFn);
    new triggers.Trigger(this, 'MigrateOnDeploy', {
      handler: migrateFn,
      executeAfter: [this.cluster],
      executeOnHandlerChange: true,
      invocationType: triggers.InvocationType.REQUEST_RESPONSE,
      timeout: Duration.minutes(5),
    });

    // ── Uploads bucket (task 9) ─────────────────────────────────────────────
    this.uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: true,
      removalPolicy,
      autoDeleteObjects: !config.retainData,
      cors: [
        {
          allowedOrigins: [...props.uploadCorsOrigins],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedHeaders: ['content-type', 'content-md5', 'x-amz-*'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        { id: 'abort-incomplete-uploads', abortIncompleteMultipartUploadAfter: Duration.days(1) },
        {
          // Raw uploads only: snapshot data under snapshots/ is pinned by
          // scenarios and must never expire (task 9, P18).
          id: 'expire-uploads',
          prefix: UPLOADS_PREFIX,
          expiration: Duration.days(data.uploadRetentionDays),
          noncurrentVersionExpiration: Duration.days(30),
        },
        {
          id: 'infrequent-access',
          transitions: [{ storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: Duration.days(30) }],
        },
      ],
    });

    // ── Outputs ─────────────────────────────────────────────────────────────
    new CfnOutput(this, 'DatabaseEndpoint', {
      value: this.cluster.clusterEndpoint.hostname,
      description: 'Aurora PostgreSQL writer endpoint (reachable only inside the VPC).',
    });
    new CfnOutput(this, 'DatabaseSecretArn', {
      value: this.dbSecret.secretArn,
      description: 'Secrets Manager ARN of the database credentials.',
    });
    new CfnOutput(this, 'UploadsBucketName', {
      value: this.uploadsBucket.bucketName,
      description: 'S3 bucket for ingestion uploads (task 9).',
      exportName: `lanewise-${config.envName}-uploads-bucket`,
    });
    new CfnOutput(this, 'MigrateFunctionName', {
      value: migrateFn.functionName,
      description: 'Lambda that applies database migrations (runs automatically on deploy).',
    });
  }

  /**
   * Least-privilege uploads-bucket access for the API (task 9): Put/Get only
   * under `uploads/` (PutObject is what lets it sign presigned PUT URLs for
   * the browser) and `snapshots/` (normalised snapshot data), and ListBucket
   * limited to `uploads/` so a missing upload is a 404, not a 403. No delete.
   */
  grantIngestionAccess(grantee: iam.IGrantable): void {
    iam.Grant.addToPrincipal({
      grantee,
      actions: ['s3:PutObject', 's3:GetObject'],
      resourceArns: [
        this.uploadsBucket.arnForObjects(`${UPLOADS_PREFIX}*`),
        this.uploadsBucket.arnForObjects(`${SNAPSHOTS_PREFIX}*`),
      ],
    });
    iam.Grant.addToPrincipal({
      grantee,
      actions: ['s3:ListBucket'],
      resourceArns: [this.uploadsBucket.bucketArn],
      conditions: { StringLike: { 's3:prefix': [`${UPLOADS_PREFIX}*`] } },
    });
  }
}
