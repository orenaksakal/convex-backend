use std::time::Instant;

use anyhow::Context;
use bytes::Bytes;
use common::{
    components::ComponentPath,
    document::ParseDocument,
    knobs::{
        EXPORT_MAX_INFLIGHT_PREFETCH_BYTES,
        EXPORT_PROGRESS_UPDATE_INTERVAL,
        EXPORT_STORAGE_GET_CONCURRENCY,
    },
    persistence::LatestDocument,
    runtime::Runtime,
    types::IndexId,
};
use database::MultiTableIterator;
use fastrace::{
    future::FutureExt,
    Span,
};
use futures::{
    pin_mut,
    stream,
    Future,
    StreamExt,
    TryStreamExt,
};
use mime2ext::mime2ext;
use model::{
    exports::types::ExportRequestor,
    file_storage::{
        types::FileStorageEntry,
        FILE_STORAGE_VIRTUAL_TABLE,
    },
};
use serde::{
    Deserialize,
    Serialize,
};
use serde_json::json;
use storage::StorageExt;
use thousands::Separable;
use tokio_util::io::StreamReader;
use usage_tracking::{
    FunctionUsageTracker,
    StorageCallTracker,
    StorageUsageTracker,
};
use value::TabletId;

use crate::{
    metrics::{
        storage_file_prefetched,
        storage_file_released,
    },
    zip_uploader::ZipSnapshotUpload,
    ExportComponents,
};

struct TrackedPrefetchPermit<'a> {
    _permit: tokio::sync::SemaphorePermit<'a>,
    prefetched_bytes: Option<usize>,
}

impl<'a> TrackedPrefetchPermit<'a> {
    fn new(permit: tokio::sync::SemaphorePermit<'a>, bytes: usize) -> Self {
        storage_file_prefetched(bytes);
        Self {
            _permit: permit,
            prefetched_bytes: Some(bytes),
        }
    }

    fn serial(permit: tokio::sync::SemaphorePermit<'a>) -> Self {
        Self {
            _permit: permit,
            prefetched_bytes: None,
        }
    }
}

impl Drop for TrackedPrefetchPermit<'_> {
    fn drop(&mut self) {
        if let Some(bytes) = self.prefetched_bytes {
            storage_file_released(bytes);
        }
    }
}

async fn collect_prefetched_file<E>(
    mut stream: impl futures::Stream<Item = Result<Bytes, E>> + Unpin,
    expected_bytes: usize,
) -> anyhow::Result<Vec<Bytes>>
where
    E: Into<anyhow::Error>,
{
    let mut chunks = Vec::new();
    let mut actual_bytes = 0usize;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(Into::into)?;
        actual_bytes = actual_bytes
            .checked_add(chunk.len())
            .context("storage file size overflow while prefetching export")?;
        anyhow::ensure!(
            actual_bytes <= expected_bytes,
            "storage returned more bytes than its advertised content length: expected \
             {expected_bytes}, received at least {actual_bytes}",
        );
        chunks.push(chunk);
    }
    anyhow::ensure!(
        actual_bytes == expected_bytes,
        "storage returned fewer bytes than its advertised content length: expected \
         {expected_bytes}, received {actual_bytes}",
    );
    Ok(chunks)
}

pub(crate) async fn write_storage_table<'a, 'b: 'a, F, Fut, RT: Runtime>(
    components: &ExportComponents<RT>,
    path_prefix: &str,
    zip_snapshot_upload: &'a mut ZipSnapshotUpload<'b>,
    component_path: &ComponentPath,
    table_iterator: &mut MultiTableIterator<RT>,
    tablet_id: TabletId,
    by_id: IndexId,
    usage: &FunctionUsageTracker,
    requestor: ExportRequestor,
    update_progress: &F,
    in_component_str: &str,
    storage_total_entries: u64,
) -> anyhow::Result<()>
where
    F: Fn(String) -> Fut + Send,
    Fut: Future<Output = anyhow::Result<()>> + Send,
{
    // First write metadata to _storage/documents.jsonl
    let mut table_upload = zip_snapshot_upload
        .start_system_table(path_prefix, FILE_STORAGE_VIRTUAL_TABLE.clone())
        .await?;
    {
        let stream = table_iterator.stream_documents_in_table(tablet_id, by_id, None);
        pin_mut!(stream);
        let mut num_storage_entries: u64 = 0;
        let mut last_log_time = Instant::now();
        while let Some(LatestDocument { value: doc, .. }) = stream.try_next().await? {
            let file_storage_entry = ParseDocument::<FileStorageEntry>::parse(doc)?;
            let virtual_storage_id = file_storage_entry.id().developer_id;
            let creation_time = f64::from(file_storage_entry.creation_time());
            table_upload
                .write_json_line(json!(FileStorageZipMetadata {
                    id: virtual_storage_id.encode(),
                    creation_time: Some(creation_time),
                    sha256: Some(file_storage_entry.sha256.as_base64()),
                    size: Some(file_storage_entry.size),
                    content_type: file_storage_entry.content_type.clone(),
                    internal_id: Some(file_storage_entry.storage_id.to_string()),
                }))
                .await?;
            num_storage_entries += 1;
            if last_log_time.elapsed() >= *EXPORT_PROGRESS_UPDATE_INTERVAL {
                tracing::info!(
                    "Export _storage metadata in progress: {num_storage_entries} entries written \
                     so far",
                );
                update_progress(format!(
                    "Backing up _storage{in_component_str}: {} / {} entries (metadata)",
                    num_storage_entries.separate_with_commas(),
                    storage_total_entries.separate_with_commas(),
                ))
                .await?;
                last_log_time = Instant::now();
            }
        }
        tracing::info!("Export _storage metadata complete: {num_storage_entries} entries",);
    }
    table_upload.complete().await?;

    let max_prefetch_bytes = *EXPORT_MAX_INFLIGHT_PREFETCH_BYTES;
    let inflight_bytes_semaphore = tokio::sync::Semaphore::new(max_prefetch_bytes);
    let files_stream = table_iterator
        .stream_documents_in_table(tablet_id, by_id, None)
        .map_ok(|LatestDocument { value: doc, .. }| async {
            let file_storage_entry = ParseDocument::<FileStorageEntry>::parse(doc)?;
            let virtual_storage_id = file_storage_entry.id().developer_id;
            // Add an extension, which isn't necessary for anything and might be incorrect,
            // but allows the file to be viewed at a glance in most cases.
            let extension_guess = file_storage_entry
                .content_type
                .as_ref()
                .and_then(mime2ext)
                .map(|extension| format!(".{extension}"))
                .unwrap_or_default();
            let path = format!(
                "{path_prefix}{}/{}{extension_guess}",
                FILE_STORAGE_VIRTUAL_TABLE,
                virtual_storage_id.encode()
            );
            let file_stream = components
                .file_storage
                .get(&file_storage_entry.storage_key)
                .await?
                .with_context(|| {
                    format!(
                        "file missing from storage: {} with key {:?}",
                        file_storage_entry.developer_id().encode(),
                        file_storage_entry.storage_key,
                    )
                })?;

            let content_type = file_storage_entry
                .content_type
                .as_ref()
                .map(|ct| ct.parse())
                .transpose()?;
            usage
                .track_storage_call(
                    component_path.clone(),
                    requestor.usage_tag(),
                    file_storage_entry.storage_id.clone(),
                    content_type,
                    file_storage_entry.sha256.clone(),
                )
                .await;
            usage
                .track_storage_egress(
                    component_path.clone(),
                    requestor.usage_tag().to_string(),
                    file_stream.content_length as u64,
                )
                .await;

            let content_length = usize::try_from(file_stream.content_length)
                .context("storage returned a negative or unsupported content length")?;
            if content_length < max_prefetch_bytes {
                let permit = inflight_bytes_semaphore
                    .acquire_many(content_length as u32)
                    .await?;
                let permit = TrackedPrefetchPermit::new(permit, content_length);
                // Prefetch the file before passing it to the zip writer.
                // This can happen in parallel with other files.
                let bytes = collect_prefetched_file(file_stream.stream, content_length)
                    .in_span(Span::enter_with_local_parent("prefetch_storage_file"))
                    .await?;
                let stream = StreamReader::new(stream::iter(bytes.into_iter().map(Ok)).boxed());
                Ok((path, stream, permit))
            } else {
                // Wait until all other ongoing prefetches are finished, then stream this file
                // serially.
                let permit = inflight_bytes_semaphore
                    .acquire_many(max_prefetch_bytes as u32)
                    .await?;
                let permit = TrackedPrefetchPermit::serial(permit);
                // Note that fetching won't start until the reader is first polled (which won't
                // happen until it's passed to `stream_full_file`).
                Ok((path, file_stream.into_tokio_reader(), permit))
            }
        })
        .try_buffer_unordered(*EXPORT_STORAGE_GET_CONCURRENCY); // Note that this will return entries in an arbitrary order
    pin_mut!(files_stream);
    let mut num_files: u64 = 0;
    let mut last_log_time = Instant::now();
    while let Some((path, file_stream, permit)) = files_stream.try_next().await? {
        zip_snapshot_upload
            .stream_full_file(path, file_stream)
            .await?;
        drop(permit);
        num_files += 1;
        if last_log_time.elapsed() >= *EXPORT_PROGRESS_UPDATE_INTERVAL {
            tracing::info!(
                "Export _storage files in progress: {num_files} files downloaded so far",
            );
            update_progress(format!(
                "Backing up _storage{in_component_str}: {} / {} files (downloading)",
                num_files.separate_with_commas(),
                storage_total_entries.separate_with_commas(),
            ))
            .await?;
            last_log_time = Instant::now();
        }
    }
    tracing::info!("Export _storage files complete: {num_files} files");
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStorageZipMetadata {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(rename = "_creationTime")]
    pub creation_time: Option<f64>,
    pub sha256: Option<String>,
    pub size: Option<i64>,
    pub content_type: Option<String>,
    pub internal_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use anyhow::anyhow;
    use bytes::Bytes;
    use futures::{
        future,
        poll,
        stream,
    };
    use tokio::sync::Semaphore;

    use super::{
        collect_prefetched_file,
        TrackedPrefetchPermit,
    };

    #[tokio::test]
    async fn prefetched_file_must_match_advertised_size() -> anyhow::Result<()> {
        let chunks = stream::iter([
            Ok::<_, anyhow::Error>(Bytes::from_static(b"abc")),
            Ok::<_, anyhow::Error>(Bytes::from_static(b"defg")),
        ]);
        let result = collect_prefetched_file(chunks, 7).await?;
        assert_eq!(result.concat(), b"abcdefg");
        Ok(())
    }

    #[tokio::test]
    async fn prefetch_rejects_more_bytes_than_reserved() {
        let chunks = stream::iter([Ok::<_, anyhow::Error>(Bytes::from_static(b"too many"))]);
        let error = collect_prefetched_file(chunks, 3)
            .await
            .expect_err("prefetch must reject oversized storage responses");
        assert!(error.to_string().contains("more bytes"));
    }

    #[tokio::test]
    async fn prefetch_rejects_truncated_and_failed_storage_responses() {
        let truncated = stream::iter([Ok::<_, anyhow::Error>(Bytes::from_static(b"short"))]);
        let error = collect_prefetched_file(truncated, 8)
            .await
            .expect_err("prefetch must reject truncated storage responses");
        assert!(error.to_string().contains("fewer bytes"));

        let failed = stream::iter([
            Ok::<_, anyhow::Error>(Bytes::from_static(b"abc")),
            Err(anyhow!("injected read failure")),
        ]);
        let error = collect_prefetched_file(failed, 8)
            .await
            .expect_err("prefetch must preserve storage failures");
        assert!(error.to_string().contains("injected read failure"));
    }

    #[tokio::test]
    async fn cancelling_prefetch_releases_its_byte_budget() -> anyhow::Result<()> {
        let semaphore = Semaphore::new(8);
        let mut pending_prefetch = Box::pin(async {
            let permit = semaphore.acquire_many(8).await?;
            let _tracked_permit = TrackedPrefetchPermit::new(permit, 8);
            future::pending::<()>().await;
            anyhow::Ok(())
        });

        assert!(poll!(&mut pending_prefetch).is_pending());
        assert_eq!(semaphore.available_permits(), 0);
        drop(pending_prefetch);
        assert_eq!(semaphore.available_permits(), 8);
        Ok(())
    }
}
