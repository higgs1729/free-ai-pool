import type { ProviderId } from "./types.js";

export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly statusCode: number;
  readonly upstreamStatus: number | undefined;
  readonly details: unknown;

  constructor(options: {
    provider: ProviderId;
    message: string;
    statusCode?: number;
    upstreamStatus?: number;
    details?: unknown;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "ProviderError";
    this.provider = options.provider;
    this.statusCode = options.statusCode ?? 502;
    this.upstreamStatus = options.upstreamStatus;
    this.details = options.details;
  }
}
