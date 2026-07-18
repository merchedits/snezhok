package xyz.merchedits.snezhok.transfer

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.io.IOException
import java.util.concurrent.TimeUnit

internal const val TRANSFER_EVENT_ACTION = "xyz.merchedits.snezhok.transfer.CHANGED"
internal const val TRANSFER_EVENT_ID = "transferId"
internal const val TRANSFER_WORK_TAG = "snezhok-background-upload"

internal fun uploadWorkName(transferId: String) = "snezhok-upload-$transferId"
private fun cancelWorkName(transferId: String) = "snezhok-upload-cancel-$transferId"

internal fun notifyTransferChanged(context: Context, transferId: String) {
  context.sendBroadcast(Intent(TRANSFER_EVENT_ACTION).setPackage(context.packageName).putExtra(TRANSFER_EVENT_ID, transferId))
}

internal fun enqueueUploadWork(context: Context, spec: TransferSpec, replace: Boolean = false) {
  val constraints = Constraints.Builder()
    .setRequiredNetworkType(if (spec.allowMetered) NetworkType.CONNECTED else NetworkType.UNMETERED)
    .build()
  val request = OneTimeWorkRequestBuilder<BackgroundUploadWorker>()
    .setInputData(workDataOf(TRANSFER_EVENT_ID to spec.transferId))
    .setConstraints(constraints)
    .setBackoffCriteria(androidx.work.BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
    .addTag(TRANSFER_WORK_TAG)
    .addTag(uploadWorkName(spec.transferId))
    .build()
  WorkManager.getInstance(context).enqueueUniqueWork(
    uploadWorkName(spec.transferId),
    if (replace) ExistingWorkPolicy.REPLACE else ExistingWorkPolicy.KEEP,
    request,
  )
}

internal fun cancelUploadWork(context: Context, transferId: String) {
  val spec = TransferStore.readSpec(context, transferId)
  WorkManager.getInstance(context).cancelUniqueWork(uploadWorkName(transferId))
  val state = TransferStore.readState(context, transferId)
  if (state != null && !state.status.isTerminal) {
    TransferStore.writeState(context, transferId, state.copy(
      status = TransferStatus.CANCELLED,
      errorCode = null,
      updatedAt = System.currentTimeMillis(),
    ))
  }
  TransferStore.source(context, transferId).delete()
  notifyTransferChanged(context, transferId)
  if (spec != null && spec.capability.isNotEmpty() && spec.expiresAt > System.currentTimeMillis()) {
    val request = OneTimeWorkRequestBuilder<CancelRemoteUploadWorker>()
      .setInputData(workDataOf(TRANSFER_EVENT_ID to transferId))
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setBackoffCriteria(androidx.work.BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(cancelWorkName(transferId), ExistingWorkPolicy.REPLACE, request)
  } else {
    TransferStore.clearSecretAndSource(context, transferId)
  }
}

class BackgroundUploadWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
  override suspend fun doWork(): Result = uploadSlots.withPermit { performUpload() }

  private suspend fun performUpload(): Result {
    val transferId = inputData.getString(TRANSFER_EVENT_ID) ?: return Result.failure(errorData("missing_transfer_id"))
    val spec = TransferStore.readSpec(applicationContext, transferId) ?: return Result.failure(errorData("missing_transfer"))
    val source = TransferStore.source(applicationContext, transferId)
    if (spec.capability.isEmpty()) return fail(spec, "missing_capability", clearSource = true)
    if (spec.expiresAt <= System.currentTimeMillis() + EXPIRY_SAFETY_MS) return fail(spec, "upload_expired", clearSource = true)
    if (!source.isFile || source.length() != spec.declaredBytes) return fail(spec, "source_unavailable", clearSource = true)

    val initial = TransferStore.readState(applicationContext, transferId)
    setForeground(foregroundInfo(transferId, initial?.uploadedBytes ?: 0L, spec.declaredBytes, waiting = true))
    return try {
      val remote = UploadProtocol.head(spec)
      var offset = remote.offset
      if (remote.status !in setOf("uploading", "finalizing", "complete")) {
        throw TerminalTransferException("invalid_upload_state")
      }
      update(spec, TransferStatus.RUNNING, offset, null)
      setForeground(foregroundInfo(transferId, offset, spec.declaredBytes, waiting = false))

      if (remote.status == "uploading") {
        var conflicts = 0
        while (offset < spec.declaredBytes) {
          try {
            offset = UploadProtocol.patch(spec, source, offset, normalizedChunkBytes(spec.chunkBytes))
            conflicts = 0
          } catch (_: OffsetConflictException) {
            conflicts += 1
            if (conflicts > 3) throw RetryableTransferException("repeated_offset_conflict")
            offset = UploadProtocol.head(spec).offset
          }
          update(spec, TransferStatus.RUNNING, offset, null)
          setProgress(workDataOf("uploadedBytes" to offset, "totalBytes" to spec.declaredBytes))
          setForeground(foregroundInfo(transferId, offset, spec.declaredBytes, waiting = false))
        }
      }

      val result = UploadProtocol.complete(spec)
      TransferStore.writeResult(applicationContext, transferId, result)
      update(spec, TransferStatus.SUCCEEDED, spec.declaredBytes, null)
      TransferStore.clearSecretAndSource(applicationContext, transferId)
      TransferStore.prune(applicationContext)
      Result.success(workDataOf(TRANSFER_EVENT_ID to transferId))
    } catch (error: CancellationException) {
      throw error
    } catch (error: TerminalTransferException) {
      fail(spec, error.errorCode, clearSource = error.errorCode in TERMINAL_SOURCE_ERRORS)
    } catch (error: IllegalArgumentException) {
      fail(spec, "invalid_server_response", clearSource = false)
    } catch (error: IOException) {
      if (runAttemptCount >= MAX_RETRY_ATTEMPTS || spec.expiresAt <= System.currentTimeMillis() + EXPIRY_SAFETY_MS) {
        fail(spec, if (spec.expiresAt <= System.currentTimeMillis() + EXPIRY_SAFETY_MS) "upload_expired" else "retry_exhausted", clearSource = spec.expiresAt <= System.currentTimeMillis() + EXPIRY_SAFETY_MS)
      } else {
        val uploaded = TransferStore.readState(applicationContext, transferId)?.uploadedBytes ?: 0L
        update(spec, TransferStatus.RETRYING, uploaded, "network_retry")
        Result.retry()
      }
    }
  }

  private fun update(spec: TransferSpec, status: TransferStatus, uploaded: Long, errorCode: String?) {
    TransferStore.writeState(applicationContext, spec.transferId, TransferState(
      status = status,
      uploadedBytes = uploaded.coerceIn(0L, spec.declaredBytes),
      totalBytes = spec.declaredBytes,
      attempt = runAttemptCount + 1,
      errorCode = errorCode,
      updatedAt = System.currentTimeMillis(),
    ))
    notifyTransferChanged(applicationContext, spec.transferId)
  }

  private fun fail(spec: TransferSpec, errorCode: String, clearSource: Boolean): Result {
    val uploaded = TransferStore.readState(applicationContext, spec.transferId)?.uploadedBytes ?: 0L
    update(spec, TransferStatus.FAILED, uploaded, errorCode)
    if (clearSource) TransferStore.clearSecretAndSource(applicationContext, spec.transferId)
    return Result.failure(errorData(errorCode))
  }

  private fun foregroundInfo(transferId: String, uploaded: Long, total: Long, waiting: Boolean): ForegroundInfo {
    val channelId = "snezhok_file_transfers"
    val notifications = applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      notifications.createNotificationChannel(NotificationChannel(
        channelId,
        applicationContext.getString(R.string.snezhok_upload_channel),
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        setShowBadge(false)
        description = applicationContext.getString(R.string.snezhok_upload_channel)
      })
    }
    val progress = transferPercent(uploaded, total)
    val cancelIntent = Intent(applicationContext, TransferCancelReceiver::class.java)
      .setAction(TransferCancelReceiver.ACTION_CANCEL)
      .putExtra(TRANSFER_EVENT_ID, transferId)
    val pendingIntent = PendingIntent.getBroadcast(
      applicationContext,
      transferId.hashCode(),
      cancelIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(applicationContext, channelId)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle(applicationContext.getString(R.string.snezhok_upload_title))
      .setContentText(applicationContext.getString(if (waiting) R.string.snezhok_upload_waiting else R.string.snezhok_upload_progress, progress))
      .setOnlyAlertOnce(true)
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_PROGRESS)
      .setProgress(100, progress, waiting)
      .addAction(0, applicationContext.getString(R.string.snezhok_upload_cancel), pendingIntent)
      .build()
    val notificationId = 400_000 + (transferId.hashCode() and 0x0fffffff) % 100_000
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ForegroundInfo(notificationId, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      ForegroundInfo(notificationId, notification)
    }
  }

  private fun errorData(errorCode: String): Data = workDataOf("errorCode" to errorCode)

  companion object {
    // Avoid saturating older phones and the API with one foreground worker per
    // selected tile while still allowing two files to make forward progress.
    private val uploadSlots = Semaphore(2)
    private const val MAX_RETRY_ATTEMPTS = 7
    private const val EXPIRY_SAFETY_MS = 30_000L
    private val TERMINAL_SOURCE_ERRORS = setOf("http_401", "http_403", "http_404", "http_410", "upload_expired", "source_truncated")
  }
}

class CancelRemoteUploadWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
  override suspend fun doWork(): Result {
    val transferId = inputData.getString(TRANSFER_EVENT_ID) ?: return Result.failure()
    val spec = TransferStore.readSpec(applicationContext, transferId) ?: return Result.success()
    if (spec.capability.isEmpty() || spec.expiresAt <= System.currentTimeMillis()) {
      TransferStore.clearSecretAndSource(applicationContext, transferId)
      return Result.success()
    }
    return try {
      UploadProtocol.cancelBestEffort(spec)
      TransferStore.clearSecretAndSource(applicationContext, transferId)
      Result.success()
    } catch (_: IOException) {
      if (runAttemptCount >= 3) {
        TransferStore.clearSecretAndSource(applicationContext, transferId)
        Result.failure()
      } else Result.retry()
    }
  }
}

class TransferCancelReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_CANCEL) return
    val transferId = intent.getStringExtra(TRANSFER_EVENT_ID) ?: return
    cancelUploadWork(context.applicationContext, transferId)
  }

  companion object {
    const val ACTION_CANCEL = "xyz.merchedits.snezhok.transfer.CANCEL"
  }
}
