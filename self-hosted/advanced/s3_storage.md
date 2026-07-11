## Using S3 Storage

By default, the backend stores file data on the filesystem within the docker
container. To instead run the backend with S3 storage, set up the following
buckets and environment variables.

```sh
export AWS_REGION="your-region"
export AWS_ACCESS_KEY_ID="your-access-key-id"
export AWS_SECRET_ACCESS_KEY="your-secret-access-key"
export S3_STORAGE_EXPORTS_BUCKET="convex-snapshot-exports"
export S3_STORAGE_SNAPSHOT_IMPORTS_BUCKET="convex-snapshot-imports"
export S3_STORAGE_MODULES_BUCKET="convex-modules"
export S3_STORAGE_FILES_BUCKET="convex-user-files"
export S3_STORAGE_SEARCH_BUCKET="convex-search-indexes"
```

Optionally set the `S3_ENDPOINT_URL` environment variable. This is required for
using [R2](https://www.cloudflare.com/developer-platform/products/r2/) or some
other drop-in replacement compatible with the AWS S3 API.

### Fixed multipart parts for strict providers

Some S3-compatible providers, including Cloudflare R2, require every non-final
multipart part to have exactly the same size. Enable fixed-size buffering
explicitly; the backend does not infer provider behavior from the endpoint
hostname:

```sh
export AWS_S3_FIXED_MULTIPART_PART_SIZE_BYTES="67108864" # 64 MiB
export AWS_S3_MAX_MULTIPART_OBJECT_SIZE_BYTES="536870912000" # 500 GiB
```

The fixed part size must be between S3's 5-MiB minimum and the configured
intermediate-part maximum. The optional maximum object size is a startup
validation boundary: the backend rejects a value requiring more than 10,000
parts. Choose it at or above the largest expected snapshot export. A 64-MiB
part supports at most 640,000 MiB (625 GiB) before the 10,000-part boundary.

Do not use checksum or server-side-encryption switches as substitutes for this
setting; they do not change multipart boundaries. Existing AWS S3 deployments
retain adaptive part sizing when the fixed-size variable is unset.

For ZIP snapshot imports, compatible endpoints must return exact
`Content-Length`, `Content-Range`, and `ETag` headers for ranged `GetObject`
requests and honor `If-Match`.

Then run the backend!

## Migrating storage providers

If you are switching between local storage and S3 storage (or vice versa),
you'll need to run a snapshot export and import to migrate your data.

Run:

```sh
npx convex export --path <path-to-export-file>
```

Then set up a fresh backend with the new storage provider and import the data:

```sh
npx convex import --replace-all <path-to-export-file>
```

ZIP snapshot imports are downloaded to a local temporary file before parsing,
including when the snapshot-import bucket uses S3. The backend host or
container therefore needs temporary disk space for the full ZIP plus normal
runtime headroom. The file uses the process's default temporary directory; on
Unix, set `TMPDIR` before starting the backend to select another location. The
temporary file is removed after the import's lazy archive readers are closed.
