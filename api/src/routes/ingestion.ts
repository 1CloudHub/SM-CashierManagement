/**
 * Data ingestion, snapshots and provenance routes (task 9; SCR-050/051;
 * Req 17, 18; P5, P7, P9, P18).
 *
 *   GET   /datasets                       datasets in use + provenance (SCR-050)
 *   GET   /datasets/provenance            sample-data banner state (every page)
 *   POST  /ingestions/uploads             presigned S3 PUT URL for a CSV file
 *   POST  /ingestions                     validate an uploaded file
 *   GET   /ingestions                     ingestion history
 *   GET   /ingestions/export              ingestion history as CSV
 *   GET   /ingestions/:ingestionId        run, issues and impact
 *   GET   /ingestions/:ingestionId/report validation report as CSV
 *   POST  /ingestions/:ingestionId/load   load a validated file
 *   POST  /ingestions/:ingestionId/cancel cancel a validated file
 *   GET   /snapshots                      snapshots (optionally current only)
 *   GET   /snapshots/:snapshotId          one snapshot
 *   PATCH /snapshots/:snapshotId          set/clear the synthetic flag
 *
 * RBAC matrix row "Data ingestion and upload (SCR-050/051)": ADM V, PLN V,
 * RST M. Each route declares its guard once (`authorize('data_ingestion',
 * ...)`, task 8.1); changing the synthetic flag needs `manage`, which only
 * the Rules Steward holds (Req 17.6), and the handler re-checks that domain
 * rule (`canChangeSyntheticFlag`) as defence in depth.
 */
import { randomUUID } from 'node:crypto';
import {
  buildCsvExport,
  canChangeSyntheticFlag,
  DATASET_TYPES,
  ISSUES_PREVIEW_LIMIT,
  MAX_UPLOAD_BYTES,
  UPLOAD_CONTENT_TYPES,
  type AffectedScenario,
  type DatasetListResponse,
  type DatasetSnapshot,
  type FileDownload,
  type IngestionDetail,
  type IngestionRunDto,
  type LoadIngestionResponse,
  type ProvenanceInfo,
  type UploadUrlResponse,
  type WithProvenance,
} from '@lanewise/shared';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { authenticated, authorize } from '../auth/guards.js';
import { requirePrincipal, type RequestContext } from '../context.js';
import { actorFromPrincipal, withAuditedTransaction, type Actor } from '../db/audit.js';
import { recordExport } from '../db/repositories/exports.js';
import * as repo from '../db/repositories/ingestion-workflow.js';
import { errors } from '../http/errors.js';
import type { Router } from '../http/router.js';
import type { RouteHandler } from '../http/types.js';
import { parseInput } from '../http/validation.js';
import { isUploadKeyFor, snapshotDataKey, uploadKey } from '../ingestion/storage.js';
import { validateDataset } from '../ingestion/validate.js';

const VIEW = authorize('data_ingestion', 'view');
const MANAGE = authorize('data_ingestion', 'manage');

/** Presigned upload URLs are valid for 15 minutes. */
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const datasetType = z.enum(DATASET_TYPES);
const idParams = (name: string) => z.object({ [name]: z.uuid() });
const csvFileName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/\.csv$/i, 'Upload a .csv file.');

const uploadBody = z.object({
  datasetType,
  fileName: csvFileName,
  contentType: z.enum(UPLOAD_CONTENT_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
});

const createBody = z.object({
  datasetType,
  fileKey: z.string().min(1).max(512),
  fileName: csvFileName,
  synthetic: z.boolean(),
  columnMapping: z.record(z.string().min(1).max(64), z.string().min(1).max(255)).optional(),
});

const listQuery = z.object({
  datasetType: datasetType.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const snapshotQuery = listQuery.extend({ current: z.enum(['true', 'false']).optional() });
const loadBody = z.object({ confirmWarnings: z.boolean() });
const snapshotBody = z.object({ synthetic: z.boolean() });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function actorOf(context: RequestContext): Actor {
  return actorFromPrincipal(requirePrincipal(context), context.requestId);
}

/** The calendar date in Manila (UTC+8, no DST): master/staff snapshots cover it. */
function manilaDate(now: Date): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function detail(
  run: IngestionRunDto,
  issues: readonly IngestionDetail['issues'][number][],
  impact: readonly AffectedScenario[],
  provenance: ProvenanceInfo,
): WithProvenance<IngestionDetail> {
  return {
    run,
    issues: issues.slice(0, ISSUES_PREVIEW_LIMIT),
    issuesTruncated: issues.length > ISSUES_PREVIEW_LIMIT,
    impact,
    provenance,
  };
}

function baseName(fileName: string): string {
  return fileName.replace(/\.csv$/i, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'upload';
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function registerIngestionRoutes(router: Router, deps: AppDeps): Router {
  const listDatasets: RouteHandler = async () => {
    const db = deps.db();
    const datasets = await repo.datasetSummaries(db);
    const body: WithProvenance<DatasetListResponse> = { datasets, provenance: await repo.inUseProvenance(db) };
    return { statusCode: 200, body };
  };

  // Every signed-in role sees the sample-data banner (Req 18.1), so this
  // route is `authenticated()` rather than permissioned; it reveals only
  // which dataset types are synthetic.
  const provenance: RouteHandler = async (_request, context) => {
    requirePrincipal(context);
    const body: ProvenanceInfo = await repo.inUseProvenance(deps.db());
    return { statusCode: 200, body };
  };

  const createUploadUrl: RouteHandler = async (request, context) => {
    actorOf(context);
    const input = parseInput(uploadBody, request.body, 'body');
    const key = uploadKey(input.datasetType, randomUUID(), input.fileName);
    const signed = await deps.storage().presignPut(key, input.contentType, UPLOAD_URL_TTL_SECONDS);
    const body: UploadUrlResponse = {
      fileKey: key,
      uploadUrl: signed.url,
      headers: signed.headers,
      expiresAt: new Date(context.now().getTime() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    };
    return { statusCode: 201, body };
  };

  const createIngestion: RouteHandler = async (request, context) => {
    const actor = actorOf(context);
    const input = parseInput(createBody, request.body, 'body');
    if (!isUploadKeyFor(input.fileKey, input.datasetType)) {
      throw errors.validationFailed('The file key is not an upload for this dataset.', [
        { path: 'body.fileKey', message: 'Use the fileKey returned by POST /ingestions/uploads.' },
      ]);
    }
    const db = deps.db();
    const storage = deps.storage();
    const file = await storage.getText(input.fileKey, MAX_UPLOAD_BYTES);
    if (!file) {
      throw errors.validationFailed('The file has not been uploaded yet.', [
        { path: 'body.fileKey', message: 'Upload the file to the presigned URL first.' },
      ]);
    }
    // Reference master data of the same provenance only (P18).
    const reference = input.datasetType === 'master' ? null : await repo.referenceData(db, input.synthetic);
    const outcome = validateDataset(input.datasetType, file.text, {
      asOf: manilaDate(context.now()),
      reference,
      ...(input.columnMapping ? { mapping: input.columnMapping } : {}),
    });

    const runId = randomUUID();
    let normalized: { key: string; sha256: string } | null = null;
    if (outcome.canLoad) {
      const key = snapshotDataKey(input.datasetType, runId);
      const payload = JSON.stringify({
        datasetType: input.datasetType,
        synthetic: input.synthetic,
        coversFrom: outcome.coversFrom,
        coversTo: outcome.coversTo,
        sourceRunId: runId,
        records: outcome.records,
      });
      normalized = { key, sha256: (await storage.putText(key, payload, 'application/json')).sha256 };
    }

    const recorded = await withAuditedTransaction(db, actor, (tx) =>
      repo.recordValidation(tx, {
        runId,
        datasetType: input.datasetType,
        fileName: input.fileName,
        fileKey: input.fileKey,
        fileSha256: file.sha256,
        fileSizeBytes: file.sizeBytes,
        synthetic: input.synthetic,
        columnMapping: input.columnMapping ?? {},
        rowCount: outcome.rowCount,
        validRowCount: outcome.validRowCount,
        issues: outcome.issues,
        coversFrom: outcome.coversFrom,
        coversTo: outcome.coversTo,
        normalized,
      }),
    );
    return {
      statusCode: 201,
      body: detail(recorded.run, repo.capIssues(outcome.issues), recorded.impact, await repo.inUseProvenance(db)),
    };
  };

  const listIngestions: RouteHandler = async (request) => {
    const query = parseInput(listQuery, request.query, 'query');
    const db = deps.db();
    const runs = await repo.listRuns(db, query);
    return { statusCode: 200, body: { runs, provenance: await repo.inUseProvenance(db) } };
  };

  const exportIngestions: RouteHandler = async (request, context) => {
    const actor = actorOf(context);
    const query = parseInput(listQuery, request.query, 'query');
    const db = deps.db();
    const runs = await repo.listRuns(db, { ...query, limit: query.limit ?? 500 });
    const provenanceInfo = await repo.inUseProvenance(db);
    const content = buildCsvExport({
      title: 'Ingestion history',
      generatedAt: context.now().toISOString(),
      generatedBy: requirePrincipal(context).email,
      sampleData: provenanceInfo.sampleData,
      meta: [['Dataset', query.datasetType ?? 'all']],
      columns: ['Time', 'Dataset', 'User', 'File', 'Rows', 'Valid rows', 'Warnings', 'Errors', 'Result', 'Synthetic', 'Scenarios marked stale'],
      rows: runs.map((r) => [
        r.startedAt,
        r.datasetType,
        r.userName ?? r.userId,
        r.fileName,
        String(r.rowCount),
        String(r.validRowCount),
        String(r.warningCount),
        String(r.errorCount),
        r.status,
        r.synthetic ? 'yes' : 'no',
        String(r.staleScenarioCount),
      ]),
    });
    await withAuditedTransaction(db, actor, (tx) =>
      recordExport(tx, {
        screen: 'SCR-050',
        format: 'csv',
        objectType: 'ingestion_run',
        objectId: 'history',
        rowCount: runs.length,
        query: new URLSearchParams(request.query).toString(),
        synthetic: provenanceInfo.sampleData,
      }),
    );
    const body: FileDownload = { fileName: 'ingestion-history.csv', contentType: 'text/csv', content };
    return { statusCode: 200, body };
  };

  const getIngestion: RouteHandler = async (request) => {
    const { ingestionId } = parseInput(idParams('ingestionId'), request.params, 'params') as { ingestionId: string };
    const db = deps.db();
    const found = await repo.getRun(db, ingestionId);
    if (!found) throw errors.notFound();
    // Validated: who a load would affect; loaded: who it made stale (their
    // pins still reference the superseded snapshot).
    const impact = ['validated', 'loaded'].includes(found.run.status)
      ? await repo.affectedScenarios(db, found.baseSnapshotId)
      : [];
    return { statusCode: 200, body: detail(found.run, found.issues, impact, await repo.inUseProvenance(db)) };
  };

  const ingestionReport: RouteHandler = async (request, context) => {
    const actor = actorOf(context);
    const { ingestionId } = parseInput(idParams('ingestionId'), request.params, 'params') as { ingestionId: string };
    const db = deps.db();
    const found = await repo.getRun(db, ingestionId);
    if (!found) throw errors.notFound();
    const { run, issues } = found;
    const sampleData = run.synthetic || (await repo.inUseProvenance(db)).sampleData;
    const content = buildCsvExport({
      title: 'Validation report',
      generatedAt: context.now().toISOString(),
      generatedBy: requirePrincipal(context).email,
      sampleData,
      meta: [
        ['Dataset', run.datasetType],
        ['File', run.fileName],
        ['Result', run.status],
        ['Rows', String(run.rowCount)],
        ['Valid rows', String(run.validRowCount)],
        ['Warnings', String(run.warningCount)],
        ['Errors', String(run.errorCount)],
      ],
      columns: ['Row', 'Column', 'Severity', 'Code', 'Message'],
      rows: issues.map((i) => [i.row === 0 ? 'file' : String(i.row), i.column ?? '', i.severity, i.code, i.message]),
    });
    await withAuditedTransaction(db, actor, (tx) =>
      recordExport(tx, {
        screen: 'SCR-051',
        format: 'csv',
        objectType: 'ingestion_run',
        objectId: run.id,
        rowCount: issues.length,
        query: '',
        synthetic: sampleData,
      }),
    );
    const body: FileDownload = {
      fileName: `${baseName(run.fileName)}-validation-report.csv`,
      contentType: 'text/csv',
      content,
    };
    return { statusCode: 200, body };
  };

  const loadIngestion: RouteHandler = async (request, context) => {
    const actor = actorOf(context);
    const { ingestionId } = parseInput(idParams('ingestionId'), request.params, 'params') as { ingestionId: string };
    const input = parseInput(loadBody, request.body, 'body');
    const result = await withAuditedTransaction(deps.db(), actor, (tx) => repo.loadRun(tx, ingestionId, input));
    const body: LoadIngestionResponse = result;
    return { statusCode: 200, body };
  };

  const cancelIngestion: RouteHandler = async (request, context) => {
    const actor = actorOf(context);
    const { ingestionId } = parseInput(idParams('ingestionId'), request.params, 'params') as { ingestionId: string };
    const run = await withAuditedTransaction(deps.db(), actor, (tx) => repo.cancelRun(tx, ingestionId));
    return { statusCode: 200, body: { run } };
  };

  const listSnapshots: RouteHandler = async (request) => {
    const query = parseInput(snapshotQuery, request.query, 'query');
    const db = deps.db();
    const snapshots = await repo.listSnapshots(db, {
      datasetType: query.datasetType,
      limit: query.limit,
      currentOnly: query.current === 'true',
    });
    return { statusCode: 200, body: { snapshots, provenance: await repo.inUseProvenance(db) } };
  };

  const getSnapshot: RouteHandler = async (request) => {
    const { snapshotId } = parseInput(idParams('snapshotId'), request.params, 'params') as { snapshotId: string };
    const snapshot = await repo.getSnapshot(deps.db(), snapshotId);
    if (!snapshot) throw errors.notFound();
    return { statusCode: 200, body: snapshot };
  };

  const updateSnapshot: RouteHandler = async (request, context) => {
    const actor = actorOf(context);
    const { snapshotId } = parseInput(idParams('snapshotId'), request.params, 'params') as { snapshotId: string };
    const input = parseInput(snapshotBody, request.body, 'body');
    const db = deps.db();
    const current = await repo.getSnapshot(db, snapshotId);
    if (!current) throw errors.notFound();
    if (current.synthetic === input.synthetic) {
      throw errors.conflict(`The dataset is already ${input.synthetic ? 'synthetic' : 'real'}.`);
    }
    // Req 17.6: only a Rules Steward may clear (or set) the flag.
    if (!canChangeSyntheticFlag(actor.activeRole, current.synthetic, input.synthetic)) throw errors.forbidden();
    const body: DatasetSnapshot = await withAuditedTransaction(db, actor, (tx) =>
      repo.setSnapshotSynthetic(tx, snapshotId, input.synthetic),
    );
    return { statusCode: 200, body };
  };

  return router
    .get('/datasets', VIEW, listDatasets)
    .get('/datasets/provenance', authenticated(), provenance)
    .post('/ingestions/uploads', MANAGE, createUploadUrl)
    .post('/ingestions', MANAGE, createIngestion)
    .get('/ingestions', VIEW, listIngestions)
    .get('/ingestions/export', VIEW, exportIngestions)
    .get('/ingestions/:ingestionId', VIEW, getIngestion)
    .get('/ingestions/:ingestionId/report', VIEW, ingestionReport)
    .post('/ingestions/:ingestionId/load', MANAGE, loadIngestion)
    .post('/ingestions/:ingestionId/cancel', MANAGE, cancelIngestion)
    .get('/snapshots', VIEW, listSnapshots)
    .get('/snapshots/:snapshotId', VIEW, getSnapshot)
    .patch('/snapshots/:snapshotId', MANAGE, updateSnapshot);
}
