import * as path from 'node:path';
import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as cpactions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments';

export interface DeployPipelineStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  /**
   * CodeStar (GitHub) connection ARN from {@link PipelineIamStack} (task 3.2).
   * Used by the Source stage to pull `main`; no stored keys (NFR-SEC-004).
   */
  readonly connectionArn: string;
  /**
   * ARN of the CodePipeline service role from {@link PipelineIamStack}
   * (task 3.2). Reused so the pipeline runs under one scoped identity — no
   * duplicate role is created.
   */
  readonly pipelineRoleArn: string;
  /**
   * ARN of the shared CodeBuild service role from {@link PipelineIamStack}
   * (task 3.2). Reused by both the Build and Deploy CodeBuild projects (it
   * already carries the CDK bootstrap-role assume grant that `cdk deploy`
   * needs). No duplicate identity is created.
   */
  readonly codeBuildRoleArn: string;
}

/**
 * Deploy pipeline on merge to `main` (spec task 3.4, DEP-002 / DEP-003).
 *
 * A CDK-managed AWS CodePipeline that, on every merge to `main`, builds the SPA
 * and the API/CDK app and then `cdk deploy`s them to AWS **prod** — uploading
 * the built SPA to the S3 bucket, invalidating CloudFront, and deploying the
 * Lambda + API Gateway (and supporting) stacks.
 *
 *   Source (CodeStar Connection, branch `main`)
 *     -> Build   (CodeBuild: build SPA + type-check/synth CDK app)
 *     -> Deploy  (CodeBuild: `cdk deploy` prod; sync SPA to S3; invalidate CF)
 *
 * ── Promotion gate / staging (deferred, DEP-005) ────────────────────────────
 * The stages are deliberately kept as an ordered list so a `staging` deploy and
 * a manual-approval **promotion gate** can be inserted between Build and the
 * prod Deploy with no rework of Source/Build:
 *
 *   Source -> Build -> [Deploy-Staging] -> [Manual approval] -> Deploy-Prod
 *
 * See the marked insertion point below and the template in
 * `config/environments.ts`. Adding it is a config + wiring change; the Source
 * and Build stages are environment-agnostic.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The Build and Deploy steps reuse the shared CodeBuild role and the pipeline
 * reuses the CodePipeline role, both from {@link PipelineIamStack} — imported as
 * **immutable** so CDK does not append policies back onto them (which would
 * create a cross-stack dependency cycle). Their permissions are defined once, in
 * `PipelineIamStack`.
 */
export class DeployPipelineStack extends Stack {
  /** The deploy pipeline name. */
  public readonly pipelineName: string;
  /** The build CodeBuild project name. */
  public readonly buildProjectName: string;
  /** The deploy CodeBuild project name. */
  public readonly deployProjectName: string;

  constructor(scope: Construct, id: string, props: DeployPipelineStackProps) {
    super(scope, id, props);

    const { config, connectionArn, pipelineRoleArn, codeBuildRoleArn } = props;
    const { github } = config;

    this.pipelineName = `lanewise-${config.envName}-deploy`;
    this.buildProjectName = `lanewise-${config.envName}-build`;
    this.deployProjectName = `lanewise-${config.envName}-deploy-cdk`;

    // Reuse the scoped roles from PipelineIamStack. Imported immutable so CDK
    // does not attach extra inline policies back onto them (avoids a cycle).
    const pipelineRole = iam.Role.fromRoleArn(this, 'ImportedPipelineRole', pipelineRoleArn, {
      mutable: false,
    });
    const codeBuildRole = iam.Role.fromRoleArn(this, 'ImportedCodeBuildRole', codeBuildRoleArn, {
      mutable: false,
    });

    // Artifact bucket for the pipeline. Not retained: artifacts are disposable
    // build outputs, not application data, so this is safe to destroy with the
    // stack regardless of the env's data-retention setting.
    const artifactBucket = new s3.Bucket(this, 'ArtifactBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ── Build project: build the SPA + type-check/synth the CDK app ─────────
    // Produces the SPA dist and the synthesized CDK cloud assembly as the build
    // artifact consumed by the Deploy stage.
    const buildProject = new codebuild.PipelineProject(this, 'BuildProject', {
      projectName: this.buildProjectName,
      description: `LaneWise deploy build (${config.envName}) — build SPA + CDK app (DEP-002).`,
      role: codeBuildRole,
      buildSpec: codebuild.BuildSpec.fromSourceFilename(
        path.posix.join('infra', 'buildspec-deploy.yml'),
      ),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        LANEWISE_ENV: { value: config.envName },
      },
    });

    // ── Deploy project: `cdk deploy` prod; sync SPA to S3; invalidate CF ────
    // Runs the actual deployment. Reuses the same CodeBuild role, which already
    // holds the CDK bootstrap-role assume grant `cdk deploy` requires.
    const deployProject = new codebuild.PipelineProject(this, 'DeployProject', {
      projectName: this.deployProjectName,
      description:
        `LaneWise deploy (${config.envName}) — cdk deploy prod, sync SPA to S3, ` +
        'invalidate CloudFront (DEP-003).',
      role: codeBuildRole,
      buildSpec: codebuild.BuildSpec.fromSourceFilename(
        path.posix.join('infra', 'buildspec-cdk-deploy.yml'),
      ),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        LANEWISE_ENV: { value: config.envName },
      },
    });

    // ── Artifacts ───────────────────────────────────────────────────────────
    const sourceOutput = new codepipeline.Artifact('SourceOutput');
    const buildOutput = new codepipeline.Artifact('BuildOutput');

    // ── Stages ──────────────────────────────────────────────────────────────
    // Source: the CodeStar Connection emits the `main` change (DEP-002).
    const sourceStage: codepipeline.StageProps = {
      stageName: 'Source',
      actions: [
        new cpactions.CodeStarConnectionsSourceAction({
          actionName: 'GitHub_Source',
          owner: github.owner,
          repo: github.repo,
          branch: github.branch,
          connectionArn,
          output: sourceOutput,
          // The full repo tree is the build input (frontend + infra live at root).
          codeBuildCloneOutput: false,
          triggerOnPush: true,
        }),
      ],
    };

    // Build: CodeBuild builds the SPA and the API/CDK app (DEP-002).
    const buildStage: codepipeline.StageProps = {
      stageName: 'Build',
      actions: [
        new cpactions.CodeBuildAction({
          actionName: 'Build_SPA_and_API',
          project: buildProject,
          input: sourceOutput,
          outputs: [buildOutput],
        }),
      ],
    };

    // Deploy: `cdk deploy` to prod — SPA to S3 + CloudFront invalidation +
    // Lambda/API Gateway (DEP-003).
    const deployProdStage: codepipeline.StageProps = {
      stageName: 'Deploy-Prod',
      actions: [
        new cpactions.CodeBuildAction({
          actionName: 'CDK_Deploy_Prod',
          project: deployProject,
          input: buildOutput,
        }),
      ],
    };

    // ── Assemble stages in order ────────────────────────────────────────────
    // Keeping stages as an ordered array (rather than inline in the Pipeline
    // constructor) is what makes the staging + promotion-gate insertion a
    // one-line change with no rework of Source/Build.
    const stages: codepipeline.StageProps[] = [sourceStage, buildStage];

    // ── PROMOTION GATE / STAGING INSERTION POINT (DEP-005) ──────────────────
    // When `staging` is introduced (see config/environments.ts), insert the
    // staging deploy and a manual-approval promotion gate here, before the prod
    // deploy — e.g.:
    //
    //   stages.push({
    //     stageName: 'Deploy-Staging',
    //     actions: [ new cpactions.CodeBuildAction({ ...deploy to staging... }) ],
    //   });
    //   stages.push({
    //     stageName: 'Promote-To-Prod',
    //     actions: [ new cpactions.ManualApprovalAction({ actionName: 'Approve' }) ],
    //   });
    //
    // No change to Source/Build is required.
    stages.push(deployProdStage);

    const pipeline = new codepipeline.Pipeline(this, 'DeployPipeline', {
      pipelineName: this.pipelineName,
      role: pipelineRole,
      artifactBucket,
      // V2 pipelines support richer triggers; the connection source above uses
      // push-based triggering on the tracked branch.
      pipelineType: codepipeline.PipelineType.V2,
      stages,
    });

    // ── Outputs ───────────────────────────────────────────────────────────
    new CfnOutput(this, 'DeployPipelineName', {
      value: pipeline.pipelineName,
      description: 'CodePipeline that deploys LaneWise to prod on merge to main.',
    });
    new CfnOutput(this, 'BuildProjectName', {
      value: buildProject.projectName,
      description: 'CodeBuild project that builds the SPA + CDK app.',
    });
    new CfnOutput(this, 'DeployProjectName', {
      value: deployProject.projectName,
      description: 'CodeBuild project that runs cdk deploy to prod.',
    });
  }
}
