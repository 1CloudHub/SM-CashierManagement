import * as path from 'node:path';
import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments';

export interface PipelinePrChecksStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  /**
   * ARN of the CodeBuild service role created in {@link PipelineIamStack}
   * (task 3.2). Reused here so PR checks and deploy builds share one scoped
   * identity — no duplicate role is created.
   *
   * It is imported as an **immutable** role so CDK will not try to append a
   * project-scoped inline policy back onto the role in `PipelineIamStack`
   * (which would create a cross-stack dependency cycle). The role's permissions
   * are defined once, in `PipelineIamStack`.
   */
  readonly codeBuildRoleArn: string;
  /**
   * CodeStar (GitHub) connection ARN from {@link PipelineIamStack}. The project
   * authenticates its GitHub source and webhook through this connection, so no
   * account-level GitHub token is needed.
   */
  readonly connectionArn: string;
}

/**
 * Pull-request checks build project (spec task 3.3, DEP-002).
 *
 * A single CodeBuild project, sourced from GitHub through the CodeStar
 * Connection, that runs on every pull request against `main` and reports its
 * status back to the PR. It runs `buildspec-pr.yml`:
 * install → build → lint → test → `cdk synth` → `cdk diff` (DEP-002).
 *
 * A non-zero exit fails the build → a failing check on the PR. Once that
 * check's context name (see {@link statusCheckContext} / the stack output) is
 * added to `main`'s required status checks (DEP-001 branch protection), a
 * failing check **blocks merge**.
 *
 * ── How PR status reporting works ───────────────────────────────────────────
 * The project uses a GitHub webhook filter (via the same GitHub App /
 * connection authorised for the pipeline) that fires on
 * PULL_REQUEST_CREATED / _UPDATED / _REOPENED. With `reportBuildStatus: true`
 * on the GitHub source, CodeBuild posts a commit status back to the PR. This is
 * why the project's source is `codebuild.Source.gitHub(...)` (webhook-capable)
 * rather than a CodePipeline source action — CodePipeline sources cannot report
 * PR-level status.
 *
 * The webhook is created against the GitHub repo using the org-level GitHub App
 * install completed during the connection handshake (task 3.2). No token is
 * stored in the template.
 * ────────────────────────────────────────────────────────────────────────────
 */
export class PipelinePrChecksStack extends Stack {
  /** The PR checks CodeBuild project name (also the basis of the PR check context). */
  public readonly projectName: string;
  /**
   * The GitHub commit-status **context** name this build reports under. Add
   * this exact string to `main`'s required status checks (DEP-001) so a failing
   * PR build blocks merge. For a CodeBuild GitHub source the context is
   * `AWS CodeBuild <region> (<project-name>)`.
   */
  public readonly statusCheckContext: string;

  constructor(scope: Construct, id: string, props: PipelinePrChecksStackProps) {
    super(scope, id, props);

    const { config, codeBuildRoleArn, connectionArn } = props;
    const { github } = config;

    this.projectName = `lanewise-${config.envName}-pr-checks`;

    // Import the shared CodeBuild role as immutable so CDK does not attach a
    // project-scoped policy back onto it (that would cause a stack cycle).
    const codeBuildRole = iam.Role.fromRoleArn(this, 'ImportedCodeBuildRole', codeBuildRoleArn, {
      mutable: false,
    });

    // GitHub source via the connection's GitHub App. The webhook filters to PRs
    // against the tracked branch only, so pushes to feature branches or other
    // events do not trigger a build.
    const source = codebuild.Source.gitHub({
      owner: github.owner,
      repo: github.repo,
      // Post a commit status back to the PR (the "check"). This is what branch
      // protection consumes once the context is added to the required list.
      reportBuildStatus: true,
      webhook: true,
      webhookFilters: [
        codebuild.FilterGroup.inEventOf(
          codebuild.EventAction.PULL_REQUEST_CREATED,
          codebuild.EventAction.PULL_REQUEST_UPDATED,
          codebuild.EventAction.PULL_REQUEST_REOPENED,
        ).andBaseBranchIs(github.branch),
      ],
    });

    const project = new codebuild.Project(this, 'PrChecksProject', {
      projectName: this.projectName,
      description:
        `LaneWise PR checks (${config.envName}) — install/build/lint/test/cdk ` +
        'synth+diff on pull requests against ' +
        `${github.branch}; reports status back to the PR (DEP-002).`,
      source,
      // Reuse the scoped CodeBuild role from PipelineIamStack (task 3.2) — no
      // duplicate identity.
      role: codeBuildRole,
      buildSpec: codebuild.BuildSpec.fromSourceFilename(
        // Path is relative to the repo root (source root), where CodeBuild
        // checks out the PR branch.
        path.posix.join('infra', 'buildspec-pr.yml'),
      ),
      environment: {
        // Node 20 toolchain; standard 7.0 image ships Node 20 + the AWS CLI.
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
    });

    // Authenticate the GitHub source (checkout, webhook, PR status) through the
    // CodeStar connection instead of an account-level GitHub token. The L2
    // GitHubSource has no connection option, so set it on the L1 resource.
    (project.node.defaultChild as codebuild.CfnProject).addPropertyOverride('Source.Auth', {
      Type: 'CODECONNECTIONS',
      Resource: connectionArn,
    });

    // `AWS CodeBuild <region> (<project>)` is the commit-status context CodeBuild
    // reports under for a GitHub source. Build it from the resolved region.
    this.statusCheckContext = `AWS CodeBuild ${Stack.of(this).region} (${this.projectName})`;

    new CfnOutput(this, 'PrChecksProjectName', {
      value: project.projectName,
      description: 'CodeBuild project that runs the LaneWise PR checks.',
    });
    new CfnOutput(this, 'PrChecksStatusCheckContext', {
      value: this.statusCheckContext,
      description:
        'GitHub commit-status context for the PR build. Add this to main\'s ' +
        'required status checks (DEP-001) so a failing build blocks merge. ' +
        'Note: <region> resolves at deploy time (e.g. AWS CodeBuild ap-southeast-1 (' +
        `${this.projectName})).`,
    });
  }
}
