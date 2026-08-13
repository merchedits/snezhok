package xyz.merchedits.snezhok.transfer

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

internal class RetryableTransferException(message: String, cause: Throwable? = null) : IOException(message, cause)
internal class TerminalTransferException(val errorCode: String) : IOException(errorCode)
internal class OffsetConflictException : IOException("upload_offset_conflict")
internal const val FINALIZE_CONTENT_TYPE = "application/json"
internal val FINALIZE_BODY = byteArrayOf('{'.code.toByte(), '}'.code.toByte())

internal object UploadProtocol {
  suspend fun head(spec: TransferSpec): RemoteUploadState = withContext(Dispatchers.IO) {
    val connection = open(spec, "uploads/${spec.uploadId}", "HEAD")
    try {
      val statusCode = connection.responseCode
      checkStatus(statusCode)
      val offset = connection.getHeaderField("Upload-Offset")?.toLongOrNull()
        ?: throw RetryableTransferException("missing_upload_offset")
      if (offset !in 0..spec.declaredBytes) throw RetryableTransferException("invalid_upload_offset")
      RemoteUploadState(offset, connection.getHeaderField("Upload-Status") ?: "uploading")
    } finally {
      connection.disconnect()
    }
  }

  suspend fun patch(spec: TransferSpec, source: File, offset: Long, requestedBytes: Int): Long = withContext(Dispatchers.IO) {
    val length = minOf(requestedBytes.toLong(), spec.declaredBytes - offset).toInt()
    if (length <= 0) return@withContext offset
    val connection = open(spec, "uploads/${spec.uploadId}/chunk", "PATCH").apply {
      doOutput = true
      setRequestProperty("Content-Type", "application/offset+octet-stream")
      setRequestProperty("Upload-Offset", offset.toString())
      setFixedLengthStreamingMode(length)
    }
    try {
      RandomAccessFile(source, "r").use { input ->
        input.seek(offset)
        connection.outputStream.use { output ->
          val buffer = ByteArray(64 * 1024)
          var remaining = length
          while (remaining > 0) {
            currentCoroutineContext().ensureActive()
            val read = input.read(buffer, 0, minOf(buffer.size, remaining))
            if (read <= 0) throw TerminalTransferException("source_truncated")
            output.write(buffer, 0, read)
            remaining -= read
          }
          output.flush()
        }
      }
      val statusCode = connection.responseCode
      if (statusCode == HttpURLConnection.HTTP_CONFLICT) throw OffsetConflictException()
      checkStatus(statusCode)
      val next = connection.getHeaderField("Upload-Offset")?.toLongOrNull() ?: (offset + length)
      if (next <= offset || next > spec.declaredBytes) throw RetryableTransferException("invalid_upload_offset")
      next
    } finally {
      connection.disconnect()
    }
  }

  suspend fun complete(spec: TransferSpec): String = withContext(Dispatchers.IO) {
    val connection = open(spec, "uploads/${spec.uploadId}/complete", "POST").apply {
      doOutput = true
      setRequestProperty("Content-Type", FINALIZE_CONTENT_TYPE)
      setFixedLengthStreamingMode(FINALIZE_BODY.size)
    }
    try {
      connection.outputStream.use { output ->
        output.write(FINALIZE_BODY)
        output.flush()
      }
      checkStatus(connection.responseCode)
      val bytes = connection.inputStream.use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(16 * 1024)
        while (output.size() <= MAX_RESULT_BYTES) {
          val read = input.read(buffer)
          if (read < 0) break
          output.write(buffer, 0, read)
        }
        output.toByteArray()
      }
      if (bytes.size > MAX_RESULT_BYTES) throw TerminalTransferException("response_too_large")
      bytes.toString(Charsets.UTF_8)
    } finally {
      connection.disconnect()
    }
  }

  suspend fun cancelBestEffort(spec: TransferSpec) = withContext(Dispatchers.IO) {
    if (spec.capability.isEmpty()) return@withContext
    val connection = open(spec, "uploads/${spec.uploadId}", "DELETE")
    try {
      connection.responseCode
    } catch (_: IOException) {
      // The server expires the capability and temporary file independently.
    } finally {
      connection.disconnect()
    }
  }

  internal fun validatedBaseUrl(raw: String): String {
    val uri = runCatching { URI(raw) }.getOrNull() ?: throw IllegalArgumentException("Invalid API URL")
    require(uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank()) { "Background transfers require HTTPS" }
    require(uri.rawUserInfo == null && uri.rawFragment == null && uri.rawQuery == null) { "Invalid API URL" }
    return raw.trimEnd('/')
  }

  private fun open(spec: TransferSpec, relativePath: String, method: String): HttpURLConnection {
    val base = validatedBaseUrl(spec.apiBaseUrl)
    return (URL("$base/$relativePath").openConnection() as HttpURLConnection).apply {
      requestMethod = method
      instanceFollowRedirects = false // Never forward a capability to another origin.
      connectTimeout = CONNECT_TIMEOUT_MS
      readTimeout = READ_TIMEOUT_MS
      useCaches = false
      setRequestProperty("Accept", "application/json")
      setRequestProperty("Cache-Control", "no-store")
      setRequestProperty("Upload-Capability", spec.capability)
    }
  }

  private fun checkStatus(status: Int) {
    if (status in 200..299) return
    if (retryableHttpStatus(status)) throw RetryableTransferException("http_$status")
    throw TerminalTransferException("http_$status")
  }

  private const val CONNECT_TIMEOUT_MS = 20_000
  private const val READ_TIMEOUT_MS = 90_000
  private const val MAX_RESULT_BYTES = 2 * 1024 * 1024
}
