import type { RequestContext } from '../context.js';

/** Transport-neutral request, produced by the Lambda adapter (or a test). */
export interface ApiRequest {
  /** Upper-case HTTP method. */
  readonly method: string;
  readonly path: string;
  /** Header names are lower-cased. */
  readonly headers: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  /** Parsed JSON body, or `undefined` when there is none. Validate before use. */
  readonly body: unknown;
}

export interface RoutedRequest extends ApiRequest {
  /** Decoded path parameters, e.g. `{ scenarioId: 'abc' }` for `/scenarios/:scenarioId`. */
  readonly params: Readonly<Record<string, string>>;
  /** The matched route pattern, e.g. `/scenarios/:scenarioId` (safe to log). */
  readonly route: string;
}

export interface ApiResponse {
  readonly statusCode: number;
  readonly headers?: Readonly<Record<string, string>>;
  /** Serialised as JSON by the adapter. */
  readonly body: unknown;
}

export type RouteHandler = (
  request: RoutedRequest,
  context: RequestContext,
) => ApiResponse | Promise<ApiResponse>;
