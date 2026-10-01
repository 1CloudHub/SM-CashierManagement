import { Aws, CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import * as codestarconnections from 'aws-cdk-lib/aws-codestarconnections';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { appRegionOf, type EnvironmentConfig } from '../config/environments';

export interface PipelineIamStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}

/**
 * Source connection + pipeline identities for the LaneWise CI/CD pipeline
 * (task 3.2, ADR-0004 / DEP-002, NFR-SEC-004).
 *
 * This stack defines *only* the plumbing the pipeline runs on — it does not
 * create the pipeline or the build projects themselves (tasks 3.3 / 3.4):
 *
 *  1. A CodeStar (GitHub) **Connection** so AWS can source the repo and report
 *     PR status without any stored GitHub credentials or AWS access keys.
 *  2. A scoped **CodePipeline** service role (orchestration only).
 *  3. A scoped **CodeBuild** service role (build, test, `cdk synth`/`diff`).
 *
 * ── MANUAL STEP REQUIRED ────────────────────────────────────────────────────
 * CDK creates the connection in a **PENDING** state. Before any pipeline can
 * pull the repo, a human must complete the one-time **GitHub App handshake** in
 * the AWS console (CodePipeline → Settings → Connections → select this
 * connection → "Update pending connection" → authorise the AWS Connector for
 * GitHub App on the org/repo). This is intentionally not automated — there is no
 * API to complete the OAuth/App handshake — and must be done by the repo owner.
 * See the stack README / task report for the exact steps.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Least-privilege notes are inline on each policy. Roles are scoped to this
 * account/region and, where practical, to LaneWise-named resources. The two
 * intentionally broad grants (CloudFormation/CDK bootstrap access for deploys,
 * and CloudWatch Logs) are called out with the reason they are needed.
 */
export class PipelineIamStack extends Stack {
  /** The CodeStar (GitHub) connection ARN, consumed by the source stage (task 3.4). */
  public readonly connectionArn: string;
  /** Service role assumed by CodePipeline. */
  public readonly pipelineRole: iam.Role;
  /** Service role assumed by CodeBuild projects (PR checks + deploy build). */
  public readonly codeBuildRole: iam.Role;

  constructor(scope: Construct, id: string, props: PipelineIamStackProps) {
    super(scope, id, props);

    const { config } = props;
    const { github } = config;
    // Regions `cdk deploy --all` targets: SPA hosting + CI/CD (`region`) and
    // the application stacks (`appRegion`, prod: us-east-2). Unset => this
    // stack's region (resolved at deploy).
    const deployRegions = [...new Set([config.region ?? Aws.REGION, appRegionOf(config) ?? Aws.REGION])];

    // ── 1. CodeStar (GitHub) Connection ────────────────────────────────────
    // Created PENDING; authorised once via the console GitHub App handshake.
    // No secrets are stored in the template — the connection *is* the credential
    // broker (NFR-SEC-004: no long-lived keys).
    const connection = new codestarconnections.CfnConnection(this, 'GitHubConnection', {
      connectionName: github.connectionName,
      providerType: 'GitHub',
    });
    this.connectionArn = connection.attrConnectionArn;

    // ── 2. CodePipeline service role ────────────────────────────────────────
    // CodePipeline only orchestrates: it uses the connection to read the source,
    // hands artifacts to CodeBuild, and passes (assumes) the roles of the
    // actions it runs. It does not deploy directly.
    this.pipelineRole = new iam.Role(this, 'PipelineRole', {
      roleName: `lanewise-${config.envName}-pipeline`,
      assumedBy: new iam.ServicePrincipal('codepipeline.amazonaws.com'),
      description: 'CodePipeline orchestration role for the LaneWise CI/CD pipeline.',
    });

    // Use the GitHub connection as the source (only this connection).
    this.pipelineRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'UseGitHubConnection',
        actions: ['codestar-connections:UseConnection'],
        resources: [this.connectionArn],
      }),
    );

    // Start and observe CodeBuild builds. Scoped to LaneWise-named projects in
    // this account/region (the build projects are created in tasks 3.3/3.4).
    this.pipelineRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'RunCodeBuild',
        actions: [
          'codebuild:StartBuild',
          'codebuild:BatchGetBuilds',
          'codebuild:StopBuild',
        ],
        resources: [`arn:${Aws.PARTITION}:codebuild:${Aws.REGION}:${Aws.ACCOUNT_ID}:project/lanewise-*`],
      }),
    );

    // Assume the action roles (e.g. the CodeBuild role, and a future deploy
    // role) that the pipeline stages run under. Scoped to LaneWise roles in
    // this account.
    this.pipelineRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeActionRoles',
        actions: ['sts:AssumeRole', 'iam:PassRole'],
        resources: [`arn:${Aws.PARTITION}:iam::${Aws.ACCOUNT_ID}:role/lanewise-*`],
      }),
    );

    // ── 3. CodeBuild service role ───────────────────────────────────────────
    // Runs install/build/lint/test and `cdk synth`/`cdk diff` for PR checks,
    // and builds the SPA/API artifacts for the deploy pipeline.
    this.codeBuildRole = new iam.Role(this, 'CodeBuildRole', {
      roleName: `lanewise-${config.envName}-codebuild`,
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      description: 'CodeBuild role for LaneWise PR checks and deploy builds.',
    });

    // CloudWatch Logs — CodeBuild streams build logs. Scoped to the LaneWise
    // build log groups in this account/region.
    // (Intentionally covers a log-group name prefix because the exact build
    // project names are set in tasks 3.3/3.4; still bounded to /aws/codebuild/lanewise-*.)
    this.codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'BuildLogs',
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:${Aws.PARTITION}:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:/aws/codebuild/lanewise-*`,
          `arn:${Aws.PARTITION}:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:log-group:/aws/codebuild/lanewise-*:*`,
        ],
      }),
    );

    // Report CodeBuild build status back to the pull request via the
    // connection (the PR "check"). Scoped to this connection only.
    this.codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReportPrStatusViaConnection',
        actions: [
          'codestar-connections:UseConnection',
          'codestar-connections:GetConnection',
          'codestar-connections:GetConnectionToken',
          'codeconnections:UseConnection',
          'codeconnections:GetConnection',
          'codeconnections:GetConnectionToken',
        ],
        resources: [this.connectionArn],
      }),
    );

    // CDK synth/diff need to read the CDK bootstrap SSM parameter and assume the
    // CDK bootstrap roles (lookup/deploy) so `cdk synth`/`cdk diff` can resolve
    // context and diff against the deployed stacks. This is the standard CDK
    // execution surface; it is bounded to the `cdk-*` bootstrap roles and the
    // CDK bootstrap SSM namespace rather than a blanket admin grant.
    this.codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        resources: [`arn:${Aws.PARTITION}:iam::${Aws.ACCOUNT_ID}:role/cdk-*`],
      }),
    );
    this.codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadCdkBootstrapVersion',
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: deployRegions.map(
          (region) => `arn:${Aws.PARTITION}:ssm:${region}:${Aws.ACCOUNT_ID}:parameter/cdk-bootstrap/*`,
        ),
      }),
    );

    // ── Deploy-stage grants (task 3.4, DEP-003) ─────────────────────────────
    // The deploy build (buildspec-cdk-deploy.yml) runs `cdk deploy` (which
    // assumes the cdk-* bootstrap roles above) and then, *directly under this
    // role*, publishes the SPA: read the SpaHosting stack outputs, sync the
    // built SPA to the S3 bucket, and invalidate the CloudFront distribution.
    // Those three post-deploy actions are the extra surface below.

    // Read CloudFormation stack outputs to resolve the SPA bucket name and the
    // CloudFront distribution id at deploy time (no hardcoded names), and the
    // Auth/Api outputs for runtime-config.json from the application region.
    // Scoped to LaneWise-named stacks in this account, in the deploy regions.
    this.codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadLaneWiseStackOutputs',
        actions: ['cloudformation:DescribeStacks'],
        resources: deployRegions.map(
          (region) => `arn:${Aws.PARTITION}:cloudformation:${region}:${Aws.ACCOUNT_ID}:stack/LaneWise-*/*`,
        ),
      }),
    );

    // Upload the built SPA to the SPA hosting bucket. The bucket name is
    // generated by CloudFormation, so this is scoped to LaneWise-prefixed
    // buckets rather than a single ARN; ListBucket is needed for `s3 sync
    // --delete` to enumerate existing objects.
    this.codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'PublishSpaToS3',
        actions: [
          's3:PutObject',
          's3:DeleteObject',
          's3:GetObject',
          's3:ListBucket',
          's3:GetBucketLocation',
        ],
        resources: [
          `arn:${Aws.PARTITION}:s3:::lanewise-*`,
          `arn:${Aws.PARTITION}:s3:::lanewise-*/*`,
          // The SPA bucket uses a CloudFormation-generated name; it is created
          // by the LaneWise-prod-SpaHosting stack, whose logical id prefixes the
          // physical name. Cover the generated pattern too.
          `arn:${Aws.PARTITION}:s3:::lanewise-prod-spahosting-*`,
          `arn:${Aws.PARTITION}:s3:::lanewise-prod-spahosting-*/*`,
        ],
      }),
    );

    // Invalidate the CloudFront distribution so the new SPA is served
    // immediately. CreateInvalidation does not support resource-level scoping in
    // IAM, so it is granted on `*` (the only unavoidable wildcard-resource
    // grant); the action itself is narrow and non-destructive.
    this.codeBuildRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'InvalidateCloudFront',
        actions: ['cloudfront:CreateInvalidation'],
        resources: ['*'],
      }),
    );

    // ── Outputs ─────────────────────────────────────────────────────────────
    new CfnOutput(this, 'GitHubConnectionArn', {
      value: this.connectionArn,
      description:
        'CodeStar (GitHub) connection ARN. NOTE: created PENDING — complete the ' +
        'GitHub App handshake in the console before the pipeline can source the repo.',
    });
    new CfnOutput(this, 'PipelineRoleArn', {
      value: this.pipelineRole.roleArn,
      description: 'Service role assumed by CodePipeline.',
    });
    new CfnOutput(this, 'CodeBuildRoleArn', {
      value: this.codeBuildRole.roleArn,
      description: 'Service role assumed by CodeBuild projects.',
    });
  }
}
