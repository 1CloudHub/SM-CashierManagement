/**
 * Structured JSON logger: one JSON object per line on stdout, which CloudWatch
 * Logs ingests as-is (OPS-001 observability). Values under sensitive keys
 * (credentials, tokens, cookies) are redacted at any depth.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly base?: LogFields;
  /** Where lines go; defaults to stdout. */
  readonly sink?: (line: string) => void;
  readonly now?: () => Date;
}

export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY =
  /(authorization|cookie|password|passwd|secret|token|api[-_]?key|credential|session)/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

const MAX_DEPTH = 8;

function sanitize(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function' || typeof value === 'symbol') return undefined;
    return value;
  }
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = isSensitiveKey(k) ? REDACTED : sanitize(v, depth + 1, seen);
  }
  return out;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const threshold = LOG_LEVELS.indexOf(options.level ?? 'info');
  const base = options.base ?? {};
  const sink = options.sink ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  const write = (level: LogLevel, msg: string, fields: LogFields = {}): void => {
    if (LOG_LEVELS.indexOf(level) < threshold) return;
    const entry = sanitize({ ...base, ...fields }, 0, new WeakSet()) as Record<string, unknown>;
    const line: Record<string, unknown> = { level, time: now().toISOString(), msg };
    // Caller fields can never overwrite the reserved level/time/msg keys.
    for (const [k, v] of Object.entries(entry)) if (!(k in line)) line[k] = v;
    sink(JSON.stringify(line));
  };

  return {
    debug: (msg, fields) => write('debug', msg, fields),
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
    child: (fields) => createLogger({ ...options, base: { ...base, ...fields } }),
  };
}
