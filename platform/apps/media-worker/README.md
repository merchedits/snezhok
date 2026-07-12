# Media worker

The worker consumes PostgreSQL `media_jobs` through a single durable `FOR UPDATE SKIP LOCKED` lease. It intentionally processes one job at a time. Failed work is retried up to four times with exponential backoff; expired heartbeats are recovered after restart. Cancellation is cooperative and terminates `ffmpeg` without invoking a shell.

The API and worker must mount the same content-addressed `STORAGE_ROOT`. Uploads remain immutable originals. Derivatives are separate `media_variants` rows and blobs:

- Images: EXIF orientation is applied, metadata/GPS is omitted, and WebP output uses 1280/72, 2560/82, or 3840/90 profiles plus a 320 px thumbnail.
- Video: H.264/AAC MP4 with `faststart`, bounded threads, 720p/1080p/2160p quality profiles, plus a 320 px thumbnail.
- Voice: mono Opus plus duration and a normalized 100-bin waveform.
- Video notes: square 720p H.264/AAC MP4 plus a thumbnail.

The `original` profile remains byte-for-byte identical and is registered as the primary variant; images and videos still receive presentation metadata and a thumbnail. The API exposes that immutable source separately as `originalUrl` for explicit uncompressed downloads.

Runtime requirements are Node.js 22, PostgreSQL 17, `ffmpeg`/`ffprobe` with `libx264`, AAC and `libopus`, and a writable shared storage mount. The supplied Dockerfile installs the Debian ffmpeg build and runs as the unprivileged `node` user.

Environment variables:

- `DATABASE_URL`, `STORAGE_ROOT`: required shared database/storage coordinates.
- `FFMPEG_THREADS` (default `2`) and `PROCESS_NICENESS` (default `10`): CPU limits inside the process; container CPU/memory limits should also be configured.
- `PAUSE_DURING_CALLS` (default `true`): does not claim work while a call is active and requeues active encoding if a call starts.
- `MIN_FREE_MEMORY_MB` (default `384`) and `MAX_LOAD_PER_CPU` (default `0.9`): capacity pause thresholds.
- `STALE_JOB_SECONDS` (default `300`): restart recovery lease timeout.

Migrations must run before starting the worker. Graceful shutdown is SIGTERM; give the container at least ten seconds so the child encoder can terminate and the job can be requeued.
