package xyz.merchedits.snezhok.transfer

import android.content.Context
import android.net.Uri
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

internal object TransferStore {
  private const val DIRECTORY_NAME = "snezhok-background-uploads"
  private const val SPEC_FILE = "transfer.json"
  private const val STATE_FILE = "state.json"
  private const val SOURCE_FILE = "source.bin"
  private const val RESULT_FILE = "result.json"
  private const val MAX_RETAINED_TRANSFERS = 64

  fun root(context: Context): File = File(context.noBackupFilesDir, DIRECTORY_NAME).apply { mkdirs() }
  fun directory(context: Context, transferId: String): File = File(root(context), transferId)
  fun source(context: Context, transferId: String): File = File(directory(context, transferId), SOURCE_FILE)

  fun initializeAndStage(context: Context, spec: TransferSpec, sourceUri: String) {
    require(validIdentifier(spec.transferId)) { "Invalid transfer identifier" }
    require(validIdentifier(spec.uploadId)) { "Invalid upload identifier" }
    require(spec.declaredBytes in 1..MAX_TRANSFER_BYTES) { "Invalid transfer size" }
    require(spec.capability.matches(Regex("^[A-Za-z0-9_-]{43}$"))) { "Invalid upload capability" }
    require(spec.expiresAt > System.currentTimeMillis()) { "Upload session has expired" }
    val directory = directory(context, spec.transferId)
    directory.mkdirs()
    writeSpec(context, spec)
    writeState(context, spec.transferId, TransferState(
      status = TransferStatus.STAGING,
      uploadedBytes = 0,
      totalBytes = spec.declaredBytes,
      attempt = 0,
      errorCode = null,
      updatedAt = System.currentTimeMillis(),
    ))

    val destination = source(context, spec.transferId)
    if (destination.isFile && destination.length() == spec.declaredBytes) {
      writeState(context, spec.transferId, queuedState(spec))
      return
    }
    val staging = File(directory, "$SOURCE_FILE.part")
    staging.delete()
    try {
      val uri = Uri.parse(sourceUri)
      val input = context.contentResolver.openInputStream(uri)
        ?: throw IllegalArgumentException("The selected file cannot be opened")
      input.use { source ->
        FileOutputStream(staging).use { output ->
          source.copyTo(output, DEFAULT_BUFFER_SIZE)
          output.fd.sync()
        }
      }
      if (staging.length() != spec.declaredBytes) throw IllegalArgumentException("The selected file size changed")
      if (destination.exists() && !destination.delete()) throw IllegalStateException("Cannot replace staged transfer")
      if (!staging.renameTo(destination)) throw IllegalStateException("Cannot commit staged transfer")
      writeState(context, spec.transferId, queuedState(spec))
    } catch (error: Throwable) {
      staging.delete()
      writeState(context, spec.transferId, TransferState(
        status = TransferStatus.FAILED,
        uploadedBytes = 0,
        totalBytes = spec.declaredBytes,
        attempt = 0,
        errorCode = "source_unavailable",
        updatedAt = System.currentTimeMillis(),
      ))
      throw error
    }
  }

  fun readSpec(context: Context, transferId: String): TransferSpec? {
    val objectValue = readObject(File(directory(context, transferId), SPEC_FILE)) ?: return null
    return runCatching {
      TransferSpec(
        transferId = objectValue.getString("transferId"),
        uploadId = objectValue.getString("uploadId"),
        apiBaseUrl = objectValue.getString("apiBaseUrl"),
        capability = if (objectValue.isNull("capability")) "" else objectValue.getString("capability"),
        declaredBytes = objectValue.getLong("declaredBytes"),
        chunkBytes = objectValue.getInt("chunkBytes"),
        expiresAt = objectValue.getLong("expiresAt"),
        allowMetered = objectValue.optBoolean("allowMetered", true),
        createdAt = objectValue.getLong("createdAt"),
      )
    }.getOrNull()
  }

  fun writeState(context: Context, transferId: String, state: TransferState) {
    val value = JSONObject()
      .put("status", state.status.wireValue)
      .put("uploadedBytes", state.uploadedBytes)
      .put("totalBytes", state.totalBytes)
      .put("attempt", state.attempt)
      .put("errorCode", state.errorCode ?: JSONObject.NULL)
      .put("updatedAt", state.updatedAt)
    atomicWrite(File(directory(context, transferId), STATE_FILE), value.toString())
  }

  fun readState(context: Context, transferId: String): TransferState? {
    val value = readObject(File(directory(context, transferId), STATE_FILE)) ?: return null
    return runCatching {
      TransferState(
        status = TransferStatus.entries.first { it.wireValue == value.getString("status") },
        uploadedBytes = value.getLong("uploadedBytes"),
        totalBytes = value.getLong("totalBytes"),
        attempt = value.optInt("attempt", 0),
        errorCode = if (value.isNull("errorCode")) null else value.getString("errorCode"),
        updatedAt = value.getLong("updatedAt"),
      )
    }.getOrNull()
  }

  fun writeResult(context: Context, transferId: String, resultJson: String) {
    // Parse before persisting so an HTML proxy error can never masquerade as a
    // completed attachment response during JS reconciliation.
    val parsed = JSONObject(resultJson)
    require(parsed.optJSONObject("attachment") != null) { "Upload response is missing an attachment" }
    atomicWrite(File(directory(context, transferId), RESULT_FILE), parsed.toString())
  }

  fun snapshot(context: Context, transferId: String): Map<String, Any?>? {
    val spec = readSpec(context, transferId) ?: return null
    val state = readState(context, transferId) ?: return null
    val result = File(directory(context, transferId), RESULT_FILE).takeIf(File::isFile)?.readText(Charsets.UTF_8)
    return mapOf(
      "transferId" to spec.transferId,
      "uploadId" to spec.uploadId,
      "status" to state.status.wireValue,
      "uploadedBytes" to state.uploadedBytes.toDouble(),
      "totalBytes" to state.totalBytes.toDouble(),
      "progress" to transferPercent(state.uploadedBytes, state.totalBytes),
      "attempt" to state.attempt,
      "errorCode" to state.errorCode,
      "createdAt" to spec.createdAt.toDouble(),
      "updatedAt" to state.updatedAt.toDouble(),
      "expiresAt" to spec.expiresAt.toDouble(),
      "allowMetered" to spec.allowMetered,
      "resultJson" to result,
    )
  }

  fun listSnapshots(context: Context): List<Map<String, Any?>> = root(context)
    .listFiles()
    .orEmpty()
    .asSequence()
    .filter(File::isDirectory)
    .mapNotNull { snapshot(context, it.name) }
    .sortedByDescending { (it["updatedAt"] as? Double) ?: 0.0 }
    .take(MAX_RETAINED_TRANSFERS)
    .toList()

  fun clearSecretAndSource(context: Context, transferId: String) {
    val spec = readSpec(context, transferId)
    if (spec != null && spec.capability.isNotEmpty()) writeSpec(context, spec.copy(capability = ""))
    source(context, transferId).delete()
  }

  fun remove(context: Context, transferId: String): Boolean {
    val state = readState(context, transferId) ?: return false
    if (!state.status.isTerminal) return false
    return directory(context, transferId).deleteRecursively()
  }

  fun prune(context: Context) {
    val directories = root(context).listFiles().orEmpty().filter(File::isDirectory)
    val terminal = directories.mapNotNull { directory ->
      readState(context, directory.name)?.takeIf { it.status.isTerminal }?.let { directory to it.updatedAt }
    }.sortedByDescending { it.second }
    terminal.drop(MAX_RETAINED_TRANSFERS).forEach { it.first.deleteRecursively() }
  }

  fun recoverScheduledTransfers(context: Context) {
    for (directory in root(context).listFiles().orEmpty().filter(File::isDirectory)) {
      val transferId = directory.name
      val spec = readSpec(context, transferId) ?: continue
      val state = readState(context, transferId) ?: continue
      if (state.status.isTerminal) continue
      val sourceReady = source(context, transferId).let { it.isFile && it.length() == spec.declaredBytes }
      if (spec.capability.isEmpty() || spec.expiresAt <= System.currentTimeMillis()) {
        writeState(context, transferId, state.copy(
          status = TransferStatus.FAILED,
          errorCode = "upload_expired",
          updatedAt = System.currentTimeMillis(),
        ))
        clearSecretAndSource(context, transferId)
        notifyTransferChanged(context, transferId)
        continue
      }
      if (!sourceReady) {
        // A process death can interrupt the copy before WorkManager is
        // enqueued. JS retains the original URI and can explicitly restage it.
        writeState(context, transferId, state.copy(
          status = TransferStatus.FAILED,
          errorCode = "source_unavailable",
          updatedAt = System.currentTimeMillis(),
        ))
        notifyTransferChanged(context, transferId)
        continue
      }
      if (state.status == TransferStatus.STAGING) writeState(context, transferId, queuedState(spec))
      enqueueUploadWork(context, spec)
    }
  }

  private fun queuedState(spec: TransferSpec) = TransferState(
    status = TransferStatus.QUEUED,
    uploadedBytes = 0,
    totalBytes = spec.declaredBytes,
    attempt = 0,
    errorCode = null,
    updatedAt = System.currentTimeMillis(),
  )

  private fun writeSpec(context: Context, spec: TransferSpec) {
    val value = JSONObject()
      .put("transferId", spec.transferId)
      .put("uploadId", spec.uploadId)
      .put("apiBaseUrl", spec.apiBaseUrl)
      .put("capability", spec.capability.ifEmpty { JSONObject.NULL })
      .put("declaredBytes", spec.declaredBytes)
      .put("chunkBytes", spec.chunkBytes)
      .put("expiresAt", spec.expiresAt)
      .put("allowMetered", spec.allowMetered)
      .put("createdAt", spec.createdAt)
    atomicWrite(File(directory(context, spec.transferId), SPEC_FILE), value.toString())
  }

  private fun readObject(file: File): JSONObject? = runCatching {
    if (!file.isFile || file.length() > 2L * 1024L * 1024L) return null
    JSONObject(file.readText(Charsets.UTF_8))
  }.getOrNull()

  private fun atomicWrite(destination: File, contents: String) {
    destination.parentFile?.mkdirs()
    val atomic = AtomicFile(destination)
    val output = atomic.startWrite()
    try {
      output.write(contents.toByteArray(Charsets.UTF_8))
      output.fd.sync()
      atomic.finishWrite(output)
    } catch (error: Throwable) {
      atomic.failWrite(output)
      throw error
    }
  }

  private fun validIdentifier(value: String): Boolean = runCatching { UUID.fromString(value) }.isSuccess

  private const val MAX_TRANSFER_BYTES = 2L * 1024L * 1024L * 1024L
}
