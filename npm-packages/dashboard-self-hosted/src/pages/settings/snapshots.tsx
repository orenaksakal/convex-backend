import { useContext, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { DeploymentSettingsLayout } from "@common/layouts/DeploymentSettingsLayout";
import { DeploymentInfoContext } from "@common/lib/deploymentContext";
import udfs from "@common/udfs";
import { Button } from "@ui/Button";
import { Callout } from "@ui/Callout";
import {
  OperatorField,
  operatorInputClasses,
} from "../../components/operator/OperatorPagePrimitives";
import { Sha256 } from "../../lib/snapshotDigest";
import { useBackendCapabilities } from "../../lib/backendCapabilities";

const IMPORT_CHUNK_SIZE = 5 * 1024 * 1024;

export default function SnapshotsPage() {
  const deployment = useContext(DeploymentInfoContext);
  const exports = useQuery(udfs.latestExport.list) ?? [];
  const imports = useQuery(udfs.snapshotImport.list) ?? [];
  const [includeStorage, setIncludeStorage] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadChecksums, setDownloadChecksums] = useState<
    Record<string, { sha256: string; sizeBytes: number }>
  >({});
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"requireEmpty" | "replaceAll">(
    "requireEmpty",
  );
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [confirmation, setConfirmation] = useState("");
  const [repairReport, setRepairReport] = useState<unknown>(null);
  const [repairConfirmation, setRepairConfirmation] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const backendCapabilities = useBackendCapabilities();

  const activeImport = imports.find((item) =>
    ["uploaded", "waiting_for_confirmation", "in_progress"].includes(
      item.state.state,
    ),
  );
  const failedImport = imports.find((item) => item.state.state === "failed");
  const importConfirmation = activeImport ? `import ${activeImport._id}` : "";
  const repairPhrase = failedImport ? `repair ${failedImport._id}` : "";
  const canOperate = deployment.ok;

  async function requestExport() {
    if (!canOperate) return;
    setExporting(true);
    setError(null);
    try {
      await deploymentFetch(
        deployment,
        `/api/export/request/zip?includeStorage=${includeStorage}`,
        { method: "POST" },
      );
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      setExporting(false);
    }
  }

  async function cancelExport(id: string) {
    if (!canOperate) return;
    setError(null);
    try {
      await deploymentFetch(
        deployment,
        `/api/export/cancel/${encodeURIComponent(id)}`,
        { method: "POST" },
      );
    } catch (requestError) {
      setError(asError(requestError));
    }
  }

  async function downloadExport(id: string, startTimestamp: bigint) {
    if (!canOperate) return;
    setDownloading(id);
    setError(null);
    try {
      const response = await deploymentFetch(
        deployment,
        `/api/export/zip/${startTimestamp.toString()}`,
      );
      const filename =
        responseFilename(response) ??
        `snapshot_${startTimestamp.toString()}.zip`;
      const checksum = await saveResponse(response, filename);
      setDownloadChecksums((current) => ({ ...current, [id]: checksum }));
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      setDownloading(null);
    }
  }

  async function uploadSnapshot() {
    if (!canOperate || !file) return;
    setUploading(true);
    setUploadProgress(0);
    setError(null);
    try {
      const start = await deploymentFetch(
        deployment,
        "/api/import/start_upload",
        { method: "POST" },
      );
      const { uploadToken } = (await start.json()) as { uploadToken: string };
      const partTokens: string[] = [];
      const chunkSize = Math.max(
        IMPORT_CHUNK_SIZE,
        Math.ceil(file.size / 9999),
      );
      let partNumber = 1;
      for (
        let offset = 0;
        offset < file.size || (file.size === 0 && offset === 0);
        offset += chunkSize
      ) {
        let chunk = file.slice(offset, Math.min(file.size, offset + chunkSize));
        if (partNumber === 1 && chunk.size >= 3) {
          const prefix = new Uint8Array(await chunk.slice(0, 3).arrayBuffer());
          if (prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf)
            chunk = chunk.slice(3);
        }
        const uploaded = await deploymentFetch(
          deployment,
          `/api/import/upload_part?uploadToken=${encodeURIComponent(uploadToken)}&partNumber=${partNumber}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: chunk,
          },
        );
        partTokens.push((await uploaded.json()) as string);
        setUploadProgress(
          file.size === 0
            ? 100
            : Math.min(
                100,
                Math.round(
                  (Math.min(file.size, offset + chunkSize) / file.size) * 100,
                ),
              ),
        );
        partNumber += 1;
        if (file.size === 0) break;
      }
      const finish = await deploymentFetch(
        deployment,
        "/api/import/finish_upload",
        {
          method: "POST",
          body: JSON.stringify({
            import: { mode, format: "zip" },
            uploadToken,
            partTokens,
          }),
        },
      );
      const { importId } = (await finish.json()) as { importId: string };
      setConfirmation("");
      if (!importId)
        throw new Error("Backend did not return an import identifier");
    } catch (requestError) {
      setError(asError(requestError));
    } finally {
      setUploading(false);
    }
  }

  async function confirmImport() {
    if (!canOperate || !activeImport || confirmation !== importConfirmation)
      return;
    setError(null);
    try {
      await deploymentFetch(deployment, "/api/perform_import", {
        method: "POST",
        body: JSON.stringify({ importId: activeImport._id }),
      });
      setConfirmation("");
    } catch (requestError) {
      setError(asError(requestError));
    }
  }

  async function cancelImport() {
    if (!canOperate || !activeImport) return;
    setError(null);
    try {
      await deploymentFetch(deployment, "/api/cancel_import", {
        method: "POST",
        body: JSON.stringify({ importId: activeImport._id }),
      });
    } catch (requestError) {
      setError(asError(requestError));
    }
  }

  async function repair(execute: boolean) {
    if (
      !canOperate ||
      !failedImport ||
      (execute && repairConfirmation !== repairPhrase)
    )
      return;
    setError(null);
    try {
      const response = await deploymentFetch(
        deployment,
        "/api/repair_failed_import_from_checkpoints",
        {
          method: "POST",
          body: JSON.stringify({ importId: failedImport._id, execute }),
        },
      );
      setRepairReport(await response.json());
      if (execute) setRepairConfirmation("");
    } catch (requestError) {
      setError(asError(requestError));
    }
  }

  return (
    <DeploymentSettingsLayout page="snapshots">
      <div className="flex flex-col gap-6">
        <header>
          <h3 className="font-semibold">Snapshot import and export</h3>
          <p className="mt-1 max-w-prose text-sm text-content-secondary">
            Create deployment-local ZIP snapshots, optionally including file
            storage, and import snapshots with explicit replace-all review.
            Logical backups and isolated disaster recovery remain on Backup &
            Restore.
          </p>
        </header>

        {error && (
          <Callout variant="error">
            <div>
              <div className="font-medium">Snapshot operation failed.</div>
              <div>{error.message}</div>
            </div>
          </Callout>
        )}

        <section
          className="rounded-lg border bg-background-secondary p-4"
          aria-labelledby="snapshot-export-title"
        >
          <h4 id="snapshot-export-title" className="font-semibold">
            Exports
          </h4>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeStorage}
              onChange={(event) => setIncludeStorage(event.target.checked)}
            />
            Include file storage
          </label>
          <Button
            className="mt-3"
            onClick={() => void requestExport()}
            loading={exporting}
            disabled={
              !canOperate ||
              exports.some(
                (item) =>
                  item.state === "requested" || item.state === "in_progress",
              )
            }
          >
            Create snapshot export
          </Button>

          <div className="mt-4 overflow-hidden rounded-md border">
            {exports.length === 0 ? (
              <div className="p-3 text-sm text-content-secondary">
                No snapshot export history.
              </div>
            ) : (
              exports.map((item) => (
                <div
                  key={item._id}
                  className="flex flex-col gap-2 border-b p-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 text-sm">
                    <div className="font-medium">
                      {item.state.replaceAll("_", " ")}
                    </div>
                    <div className="text-xs text-content-secondary">
                      Requested {new Date(item._creationTime).toLocaleString()}{" "}
                      · ID <code>{item._id}</code>
                      {item.state === "completed"
                        ? ` · expires ${timestampNanos(item.expiration_ts)}`
                        : ""}
                    </div>
                    {downloadChecksums[item._id] && (
                      <div className="mt-1 text-xs text-content-secondary">
                        Download verified locally:{" "}
                        <code className="break-all">
                          sha256:{downloadChecksums[item._id].sha256}
                        </code>{" "}
                        · {formatBytes(downloadChecksums[item._id].sizeBytes)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {item.state === "completed" && (
                      <Button
                        size="xs"
                        variant="neutral"
                        loading={downloading === item._id}
                        onClick={() =>
                          void downloadExport(item._id, item.start_ts)
                        }
                      >
                        Download
                      </Button>
                    )}
                    {(item.state === "requested" ||
                      item.state === "in_progress") && (
                      <Button
                        size="xs"
                        variant="danger"
                        onClick={() => void cancelExport(item._id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section
          className="rounded-lg border bg-background-secondary p-4"
          aria-labelledby="snapshot-import-title"
        >
          <h4 id="snapshot-import-title" className="font-semibold">
            Import a ZIP snapshot
          </h4>
          <p className="mt-1 text-sm text-content-secondary">
            Uploads use bounded multipart chunks. The backend parses first and
            requires a second confirmation before writing.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <OperatorField
              label="Snapshot ZIP"
              description="A Convex ZIP archive export. Table-level comma-separated value (CSV) and JavaScript Object Notation (JSON) imports remain available through the command-line interface (CLI)."
            >
              <input
                className={operatorInputClasses}
                type="file"
                accept=".zip,application/zip"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </OperatorField>
            <OperatorField
              label="Import mode"
              description="Require empty is safest; replace all is destructive and requires backend confirmation."
            >
              <select
                className={operatorInputClasses}
                value={mode}
                onChange={(event) => setMode(event.target.value as typeof mode)}
              >
                <option value="requireEmpty">Require empty deployment</option>
                <option value="replaceAll">Replace all tables</option>
              </select>
            </OperatorField>
          </div>
          {uploading && (
            <div className="mt-3 text-sm">
              Upload progress: {uploadProgress}%
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              onClick={() => void uploadSnapshot()}
              loading={uploading}
              disabled={!file || !!activeImport}
            >
              Upload and parse snapshot
            </Button>
            {activeImport && (
              <Button variant="danger" onClick={() => void cancelImport()}>
                Cancel active import
              </Button>
            )}
          </div>

          {activeImport?.state.state === "waiting_for_confirmation" && (
            <div className="mt-4 rounded-md border border-content-error bg-background-primary p-3 text-sm">
              <div className="font-medium">Backend confirmation required</div>
              <pre className="mt-2 scrollbar max-h-64 overflow-auto rounded-sm bg-background-tertiary p-3 text-xs whitespace-pre-wrap">
                {activeImport.state.message_to_confirm}
              </pre>
              <label className="mt-3 flex flex-col gap-1">
                Type <code>{importConfirmation}</code>
                <input
                  className={operatorInputClasses}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <Button
                className="mt-3"
                variant="danger"
                disabled={confirmation !== importConfirmation}
                onClick={() => void confirmImport()}
              >
                Confirm exact import
              </Button>
            </div>
          )}

          <ImportHistory imports={imports} />
        </section>

        {failedImport && (
          <section
            className="rounded-lg border bg-background-secondary p-4"
            aria-labelledby="snapshot-repair-title"
          >
            <h4 id="snapshot-repair-title" className="font-semibold">
              Failed replace-all checkpoint repair
            </h4>
            <p className="mt-1 text-sm text-content-secondary">
              Break-glass recovery for import <code>{failedImport._id}</code>.
              Always inspect a dry-run report first; backend drift and
              checkpoint guards still apply.
            </p>
            <Button
              className="mt-3"
              variant="neutral"
              onClick={() => void repair(false)}
            >
              Run repair dry-run
            </Button>
            {repairReport !== null && (
              <pre className="mt-3 scrollbar max-h-96 overflow-auto rounded-sm bg-background-tertiary p-3 text-xs">
                {JSON.stringify(repairReport, null, 2)}
              </pre>
            )}
            {repairReport !== null && (
              <div className="mt-3 rounded-md border border-content-error p-3">
                {!backendCapabilities.snapshotCheckpointRepairExecute && (
                  <Callout variant="instructions">
                    Destructive checkpoint activation is disabled because its
                    production fixture gate has not passed. Use the dry-run
                    report to assess the failed import, then perform a clean
                    re-import or complete the gated recovery procedure.
                  </Callout>
                )}
                <label className="flex flex-col gap-1 text-sm">
                  Type <code>{repairPhrase}</code>
                  <input
                    className={operatorInputClasses}
                    value={repairConfirmation}
                    onChange={(event) =>
                      setRepairConfirmation(event.target.value)
                    }
                    autoComplete="off"
                  />
                </label>
                <Button
                  className="mt-3"
                  variant="danger"
                  disabled={
                    !backendCapabilities.snapshotCheckpointRepairExecute ||
                    repairConfirmation !== repairPhrase
                  }
                  onClick={() => void repair(true)}
                >
                  Execute checkpoint repair
                </Button>
              </div>
            )}
          </section>
        )}
      </div>
    </DeploymentSettingsLayout>
  );
}

function ImportHistory({
  imports,
}: {
  imports: ReturnType<
    typeof useQuery<typeof udfs.snapshotImport.list>
  > extends infer Result
    ? NonNullable<Result>
    : never;
}) {
  const visible = useMemo(
    () => imports.filter((item) => item.requestor.type === "snapshotImport"),
    [imports],
  );
  return (
    <div className="mt-4 overflow-hidden rounded-md border">
      {visible.length === 0 ? (
        <div className="p-3 text-sm text-content-secondary">
          No snapshot import history.
        </div>
      ) : (
        visible.map((item) => (
          <div key={item._id} className="border-b p-3 text-sm last:border-b-0">
            <div className="font-medium">
              {item.state.state.replaceAll("_", " ")}
            </div>
            <div className="mt-1 text-xs text-content-secondary">
              <code>{item._id}</code> · {item.mode} · {item.format.format}
              {item.state.state === "in_progress"
                ? ` · ${item.state.progress_message}`
                : ""}
              {item.state.state === "completed"
                ? ` · ${item.state.num_rows_written.toString()} rows`
                : ""}
              {item.state.state === "failed"
                ? ` · ${item.state.error_message}`
                : ""}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

async function deploymentFetch(
  deployment: Extract<
    React.ContextType<typeof DeploymentInfoContext>,
    { ok: true }
  >,
  path: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Convex ${deployment.adminKey}`);
  headers.set("Convex-Client", "dashboard-self-hosted-snapshots");
  if (init.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  const response = await fetch(
    `${deployment.deploymentUrl.replace(/\/$/, "")}${path}`,
    { ...init, headers },
  );
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Backend returned ${response.status} ${response.statusText}${body ? `: ${body.slice(0, 1000)}` : ""}`,
    );
  }
  return response;
}

async function saveResponse(response: Response, filename: string) {
  const picker = (
    window as Window & {
      showSaveFilePicker?: (
        options: unknown,
      ) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>;
    }
  ).showSaveFilePicker;
  if (picker && response.body) {
    const handle = await picker({
      suggestedName: filename,
      types: [
        {
          description: "Convex snapshot",
          accept: { "application/zip": [".zip"] },
        },
      ],
    });
    const reader = response.body.getReader();
    const writer = (await handle.createWritable()).getWriter();
    const digest = new Sha256();
    let sizeBytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        digest.update(chunk.value);
        sizeBytes += chunk.value.byteLength;
        await writer.write(chunk.value);
      }
      await writer.close();
    } catch (error) {
      await writer.abort(error);
      throw error;
    }
    return { sha256: digest.hexDigest(), sizeBytes };
  }
  const blob = await response.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  const digest = new Sha256();
  digest.update(bytes);
  return { sha256: digest.hexDigest(), sizeBytes: bytes.byteLength };
}

function responseFilename(response: Response) {
  const value = response.headers.get("content-disposition");
  return value?.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}

function timestampNanos(value: bigint) {
  return new Date(Number(value / BigInt(1_000_000))).toLocaleString();
}

function formatBytes(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} gibibytes`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} mebibytes`;
  return `${value} bytes`;
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error("Unknown snapshot error");
}
