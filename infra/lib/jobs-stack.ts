import * as fs from 'node:fs';
import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import type * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments';

export interface JobsStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly vpc: ec2.IVpc;
  readonly appSubnets: ec2.SubnetSelection;
  readonly appSecurityGroup: ec2.ISecurityGroup;
  readonly dbSecret: secretsmanager.ISecret;
  /** Database connection settings from {@link DataStack} (host, name, secret ARN, TLS). */
  readonly dbEnvironment: Record<string, string>;
  /**
   * Directory with the worker code (`index.mjs`, `handler` export). The app
   * (bin/infra.ts) deploys the task 14.2 worker bundled from /api
   * (`API_WORKER_BUNDLE_DIR`); the default is the skeleton in
   * `infra/lambda/jobs-worker`, which keeps stack unit tests independent of
   * an API build.
   */
  readonly workerBundleDir?: string;
}

export const DEFAULT_WORKER_BUNDLE_DIR = path.join(__dirname, '..', 'lambda', 'jobs-worker');

/** The background-job worker bundled by `npm run build` in /api (`api/dist/jobs-worker`, task 14.2). */
export const API_WORKER_BUNDLE_DIR = path.join(__dirname, '..', '..', 'api', 'dist', 'jobs-worker');

/** Fails synth early (with how to fix it) when the API worker bundle has not been built. */
export function assertWorkerBundle(dir: string): string {
  if (!fs.existsSync(path.join(dir, 'index.mjs'))) {
    throw new Error(
      `Jobs worker bundle not found at ${dir}/index.mjs. Build it first: ` +
        '(cd packages/shared && npm ci && npm run build) && (cd packages/domain && npm ci && npm run build) && (cd api && npm ci && npm run build)',
    );
  }
  return dir;
}

/**
 * Background jobs (spec task 24 for task 14.2, ADR-0002): an encrypted SQS
 * queue with a dead-letter queue, and a worker Lambda in the VPC (app security
 * group, so it can reach Aurora) consuming it with partial batch responses.
 * Concurrency is capped so a burst of jobs cannot exhaust database capacity.
 */
export class JobsStack extends Stack {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly worker: lambda.Function;
  public readonly offerExpirySchedule: events.Rule;

  constructor(scope: Construct, id: string, props: JobsStackProps) {
    super(scope, id, props);

    const { config } = props;
    const { jobs } = config;
    const workerTimeout = Duration.seconds(jobs.workerTimeoutSeconds);

    this.deadLetterQueue = new sqs.Queue(this, 'JobsDeadLetterQueue', {
      queueName: `lanewise-${config.envName}-jobs-dlq`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      retentionPeriod: Duration.days(14),
    });
    this.queue = new sqs.Queue(this, 'JobsQueue', {
      queueName: `lanewise-${config.envName}-jobs`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      // AWS guidance: >= 6x the function timeout for SQS event sources.
      visibilityTimeout: Duration.seconds(jobs.workerTimeoutSeconds * 6),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: jobs.maxReceiveCount },
    });

    const workerLogs = new logs.LogGroup(this, 'JobsWorkerLogs', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: config.retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    this.worker = new lambda.Function(this, 'JobsWorker', {
      functionName: `lanewise-${config.envName}-jobs-worker`,
      description: 'LaneWise background-job worker (hiring plans, long rosters — task 14.2).',
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(props.workerBundleDir ?? DEFAULT_WORKER_BUNDLE_DIR),
      timeout: workerTimeout,
      memorySize: 512,
      logGroup: workerLogs,
      vpc: props.vpc,
      vpcSubnets: props.appSubnets,
      securityGroups: [props.appSecurityGroup],
      environment: {
        LANEWISE_ENV: config.envName,
        LOG_LEVEL: 'info',
        NODE_OPTIONS: '--enable-source-maps',
        JOBS_QUEUE_URL: this.queue.queueUrl,
        ...props.dbEnvironment,
      },
    });
    props.dbSecret.grantRead(this.worker);
    this.worker.addEventSource(
      new lambdaEventSources.SqsEventSource(this.queue, {
        batchSize: 1,
        reportBatchItemFailures: true,
        maxConcurrency: jobs.maxConcurrency,
      }),
    );

    // Task 17.1: shift offers expire 30 minutes after they are sent (Req 13.2);
    // the worker's sweep marks due offers expired and notifies the senders.
    this.offerExpirySchedule = new events.Rule(this, 'OfferExpirySweep', {
      description: 'Expires LaneWise shift offers past their 30 minutes and notifies the senders (task 17.1).',
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new eventsTargets.LambdaFunction(this.worker, { retryAttempts: 0 })],
    });

    new CfnOutput(this, 'JobsQueueUrl', {
      value: this.queue.queueUrl,
      description: 'SQS queue for LaneWise background jobs.',
    });
    new CfnOutput(this, 'JobsDeadLetterQueueUrl', {
      value: this.deadLetterQueue.queueUrl,
      description: 'Dead-letter queue for jobs that failed every retry.',
    });
  }
}
