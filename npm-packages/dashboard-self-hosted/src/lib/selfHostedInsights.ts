export type InsightKind =
  | "documentsReadLimit"
  | "bytesReadLimit"
  | "occFailedPermanently"
  | "documentsReadThreshold"
  | "bytesReadThreshold"
  | "occRetried";

export type SelfHostedInsight = {
  kind: InsightKind;
  severity: "error" | "warning";
  functionId: string;
  componentPath: string | null;
  tableName: string | null;
  count: number;
  recentEvents: Array<{
    timestamp: string;
    requestId: string;
    detail: string;
  }>;
};

export type InsightDiagnostics = {
  inputRecords: number;
  completionRecords: number;
  recordsInWindow: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  invalidOrFutureTimestamps: number;
  recordsBeforeWindow: number;
  peakDocumentsRead: number;
  peakBytesRead: number;
  documentsWarningThreshold: number;
  bytesWarningThreshold: number;
};

export type InsightOptions = {
  now: number;
  lookbackHours: number;
  documentsReadLimit: number;
  bytesReadLimit: number;
  warningPercent: number;
};

const KIND_ORDER: InsightKind[] = [
  "documentsReadLimit",
  "bytesReadLimit",
  "occFailedPermanently",
  "documentsReadThreshold",
  "bytesReadThreshold",
  "occRetried",
];

export function analyzeInsightEvents(
  events: unknown[],
  options: InsightOptions,
) {
  const cutoff = options.now - options.lookbackHours * 60 * 60 * 1000;
  const warningRatio = options.warningPercent / 100;
  const diagnostics: InsightDiagnostics = {
    inputRecords: events.length,
    completionRecords: 0,
    recordsInWindow: 0,
    firstTimestamp: null,
    lastTimestamp: null,
    invalidOrFutureTimestamps: 0,
    recordsBeforeWindow: 0,
    peakDocumentsRead: 0,
    peakBytesRead: 0,
    documentsWarningThreshold: Math.ceil(
      options.documentsReadLimit * warningRatio,
    ),
    bytesWarningThreshold: Math.ceil(options.bytesReadLimit * warningRatio),
  };
  const grouped = new Map<string, SelfHostedInsight>();

  for (const raw of events) {
    const event = normalize(raw);
    if (!event) continue;
    diagnostics.completionRecords += 1;
    if (!Number.isFinite(event.timestamp) || event.timestamp > options.now) {
      diagnostics.invalidOrFutureTimestamps += 1;
      continue;
    }
    if (event.timestamp < cutoff) {
      diagnostics.recordsBeforeWindow += 1;
      continue;
    }
    diagnostics.recordsInWindow += 1;
    const timestamp = new Date(event.timestamp).toISOString();
    if (!diagnostics.firstTimestamp || timestamp < diagnostics.firstTimestamp) {
      diagnostics.firstTimestamp = timestamp;
    }
    if (!diagnostics.lastTimestamp || timestamp > diagnostics.lastTimestamp) {
      diagnostics.lastTimestamp = timestamp;
    }
    diagnostics.peakDocumentsRead = Math.max(
      diagnostics.peakDocumentsRead,
      event.documentsRead,
    );
    diagnostics.peakBytesRead = Math.max(
      diagnostics.peakBytesRead,
      event.bytesRead,
    );

    if (event.occ) {
      const kind: InsightKind = event.willRetry
        ? "occRetried"
        : "occFailedPermanently";
      addInsight(grouped, {
        kind,
        functionId: event.functionId,
        componentPath: event.componentPath,
        tableName: event.occ.tableName,
        timestamp,
        requestId: event.requestId,
        detail: `${event.occ.retryCount} retries${event.occ.documentId ? ` · document ${event.occ.documentId}` : ""}`,
      });
    }

    const documentKind = resourceKind(
      "documentsRead",
      event.documentsRead,
      options.documentsReadLimit,
      warningRatio,
      event.success,
    );
    if (documentKind) {
      addInsight(grouped, {
        kind: documentKind,
        functionId: event.functionId,
        componentPath: event.componentPath,
        tableName: null,
        timestamp,
        requestId: event.requestId,
        detail: `${event.documentsRead.toLocaleString()} documents · ${formatBytes(event.bytesRead)}`,
      });
    }
    const bytesKind = resourceKind(
      "bytesRead",
      event.bytesRead,
      options.bytesReadLimit,
      warningRatio,
      event.success,
    );
    if (bytesKind) {
      addInsight(grouped, {
        kind: bytesKind,
        functionId: event.functionId,
        componentPath: event.componentPath,
        tableName: null,
        timestamp,
        requestId: event.requestId,
        detail: `${formatBytes(event.bytesRead)} · ${event.documentsRead.toLocaleString()} documents`,
      });
    }
  }

  return {
    diagnostics,
    insights: [...grouped.values()].sort((left, right) => {
      const kind =
        KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);
      return kind || left.functionId.localeCompare(right.functionId);
    }),
  };
}

function addInsight(
  grouped: Map<string, SelfHostedInsight>,
  event: {
    kind: InsightKind;
    functionId: string;
    componentPath: string | null;
    tableName: string | null;
    timestamp: string;
    requestId: string;
    detail: string;
  },
) {
  const key = JSON.stringify([
    event.kind,
    event.functionId,
    event.componentPath,
    event.tableName,
  ]);
  const insight =
    grouped.get(key) ??
    ({
      kind: event.kind,
      severity:
        event.kind.endsWith("Limit") || event.kind === "occFailedPermanently"
          ? "error"
          : "warning",
      functionId: event.functionId,
      componentPath: event.componentPath,
      tableName: event.tableName,
      count: 0,
      recentEvents: [],
    } satisfies SelfHostedInsight);
  insight.count += 1;
  insight.recentEvents.push({
    timestamp: event.timestamp,
    requestId: event.requestId,
    detail: event.detail,
  });
  insight.recentEvents.sort((left, right) =>
    right.timestamp.localeCompare(left.timestamp),
  );
  insight.recentEvents.length = Math.min(insight.recentEvents.length, 5);
  grouped.set(key, insight);
}

function resourceKind(
  metric: "documentsRead" | "bytesRead",
  value: number,
  limit: number,
  warningRatio: number,
  success: boolean,
): InsightKind | null {
  if (value < limit * warningRatio) return null;
  return `${metric}${!success || value >= limit ? "Limit" : "Threshold"}` as InsightKind;
}

function normalize(raw: unknown) {
  if (!isRecord(raw)) return null;
  if (raw.topic === "function_execution") {
    const fn = isRecord(raw.function) ? raw.function : {};
    const usage = isRecord(raw.usage) ? raw.usage : {};
    const occ = isRecord(raw.occ_info) ? raw.occ_info : null;
    return normalized({
      timestamp: timestampMs(raw.timestamp),
      functionId: fn.path,
      componentPath: fn.component_path,
      requestId: fn.request_id,
      success: raw.status === "success",
      documentsRead: usage.database_read_documents,
      bytesRead: usage.database_read_bytes,
      willRetry: raw.will_retry,
      occ,
    });
  }
  if (raw.kind !== "Completion") return null;
  const usage = isRecord(raw.usageStats) ? raw.usageStats : {};
  const occ = isRecord(raw.occInfo) ? raw.occInfo : null;
  return normalized({
    timestamp: Number(raw.timestamp) * 1000,
    functionId: raw.identifier,
    componentPath: raw.componentPath,
    requestId: raw.requestId,
    success: typeof raw.error !== "string",
    documentsRead: usage.databaseReadDocuments,
    bytesRead: usage.databaseReadBytes,
    willRetry: raw.willRetry,
    occ,
  });
}

function normalized(value: {
  timestamp: unknown;
  functionId: unknown;
  componentPath: unknown;
  requestId: unknown;
  success: unknown;
  documentsRead: unknown;
  bytesRead: unknown;
  willRetry: unknown;
  occ: Record<string, unknown> | null;
}) {
  if (typeof value.functionId !== "string" || value.functionId === "")
    return null;
  return {
    timestamp: Number(value.timestamp),
    functionId: value.functionId,
    componentPath:
      typeof value.componentPath === "string" ? value.componentPath : null,
    requestId:
      typeof value.requestId === "string" ? value.requestId : "unknown",
    success: value.success === true,
    documentsRead: finiteNumber(value.documentsRead),
    bytesRead: finiteNumber(value.bytesRead),
    willRetry: value.willRetry === true,
    occ: value.occ
      ? {
          tableName:
            stringValue(value.occ.table_name) ??
            stringValue(value.occ.tableName),
          documentId:
            stringValue(value.occ.document_id) ??
            stringValue(value.occ.documentId),
          retryCount:
            finiteNumber(value.occ.retry_count) ||
            finiteNumber(value.occ.retryCount),
        }
      : null,
  };
}

function timestampMs(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number.NaN;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : Date.parse(value);
}

function finiteNumber(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value !== "" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function formatBytes(value: number) {
  return value >= 1024 * 1024
    ? `${(value / (1024 * 1024)).toFixed(2)} MiB`
    : `${Math.round(value / 1024)} KiB`;
}
