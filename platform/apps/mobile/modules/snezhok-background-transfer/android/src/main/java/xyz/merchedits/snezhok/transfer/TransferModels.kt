package xyz.merchedits.snezhok.transfer

internal enum class TransferStatus(val wireValue: String) {
  STAGING("staging"),
  QUEUED("queued"),
  RUNNING("running"),
  RETRYING("retrying"),
  SUCCEEDED("succeeded"),
  FAILED("failed"),
  CANCELLED("cancelled");

  val isTerminal: Boolean
    get() = this == SUCCEEDED || this == FAILED || this == CANCELLED
}

internal data class TransferSpec(
  val transferId: String,
  val uploadId: String,
  val apiBaseUrl: String,
  val capability: String,
  val declaredBytes: Long,
  val chunkBytes: Int,
  val expiresAt: Long,
  val allowMetered: Boolean,
  val createdAt: Long,
)

internal data class TransferState(
  val status: TransferStatus,
  val uploadedBytes: Long,
  val totalBytes: Long,
  val attempt: Int,
  val errorCode: String?,
  val updatedAt: Long,
)

internal data class RemoteUploadState(
  val offset: Long,
  val status: String,
)

internal fun transferPercent(uploadedBytes: Long, totalBytes: Long): Int {
  if (totalBytes <= 0L) return 0
  return ((uploadedBytes.coerceIn(0L, totalBytes) * 100L) / totalBytes).toInt().coerceIn(0, 100)
}

internal fun normalizedChunkBytes(requested: Int): Int = requested.coerceIn(64 * 1024, 1024 * 1024)

internal fun retryableHttpStatus(status: Int): Boolean =
  status == 408 || status == 425 || status == 429 || status in 500..599
