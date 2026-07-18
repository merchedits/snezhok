package xyz.merchedits.snezhok.transfer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class SnezhokBackgroundTransferModule : Module() {
  private var receiver: BroadcastReceiver? = null
  private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  override fun definition() = ModuleDefinition {
    Name("SnezhokBackgroundTransfer")
    Events("onTransferChanged")

    OnCreate {
      val context = applicationContext() ?: return@OnCreate
      if (receiver != null) return@OnCreate
      receiver = object : BroadcastReceiver() {
        override fun onReceive(receiverContext: Context, intent: Intent) {
          val transferId = intent.getStringExtra(TRANSFER_EVENT_ID) ?: return
          TransferStore.snapshot(receiverContext, transferId)?.let { sendEvent("onTransferChanged", it) }
        }
      }.also { transferReceiver ->
        val filter = IntentFilter(TRANSFER_EVENT_ACTION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          context.registerReceiver(transferReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
          @Suppress("DEPRECATION") context.registerReceiver(transferReceiver, filter)
        }
      }
      ioScope.launch { TransferStore.recoverScheduledTransfers(context) }
    }

    OnDestroy {
      val context = applicationContext()
      val registered = receiver
      if (context != null && registered != null) runCatching { context.unregisterReceiver(registered) }
      receiver = null
      ioScope.cancel()
    }

    AsyncFunction("enqueueTransfer") { options: Map<String, Any?> ->
        val context = requireApplicationContext()
        val now = System.currentTimeMillis()
        val spec = TransferSpec(
          transferId = options.requiredString("transferId"),
          uploadId = options.requiredString("uploadId"),
          apiBaseUrl = UploadProtocol.validatedBaseUrl(options.requiredString("apiBaseUrl")),
          capability = options.requiredString("capability"),
          declaredBytes = options.requiredLong("declaredBytes"),
          chunkBytes = normalizedChunkBytes(options.requiredInt("chunkBytes")),
          expiresAt = options.requiredLong("expiresAt"),
          allowMetered = options["allowMetered"] as? Boolean ?: true,
          createdAt = (options["createdAt"] as? Number)?.toLong() ?: now,
        )
        TransferStore.initializeAndStage(context, spec, options.requiredString("sourceUri"))
        enqueueUploadWork(context, spec)
        notifyTransferChanged(context, spec.transferId)
        TransferStore.snapshot(context, spec.transferId) ?: error("Transfer could not be scheduled")
    }.runOnQueue(ioScope)

    AsyncFunction("listTransfers") {
      TransferStore.listSnapshots(requireApplicationContext())
    }.runOnQueue(ioScope)

    AsyncFunction("getTransfer") { transferId: String ->
      TransferStore.snapshot(requireApplicationContext(), transferId)
    }.runOnQueue(ioScope)

    AsyncFunction("cancelTransfer") { transferId: String ->
        val context = requireApplicationContext()
        cancelUploadWork(context, transferId)
        TransferStore.snapshot(context, transferId)
    }.runOnQueue(ioScope)

    AsyncFunction("resumeTransfer") { transferId: String, sourceUri: String? ->
        val context = requireApplicationContext()
        val spec = TransferStore.readSpec(context, transferId) ?: error("Transfer not found")
        val state = TransferStore.readState(context, transferId) ?: error("Transfer state not found")
        if (state.status == TransferStatus.SUCCEEDED || state.status == TransferStatus.CANCELLED) {
          return@AsyncFunction TransferStore.snapshot(context, transferId)
        }
        require(spec.capability.isNotEmpty() && spec.expiresAt > System.currentTimeMillis() + 30_000L) { "Upload session has expired" }
        val sourceReady = TransferStore.source(context, transferId).let { it.isFile && it.length() == spec.declaredBytes }
        if (!sourceReady) {
          val uri = sourceUri?.takeIf(String::isNotBlank) ?: error("The selected source must be restaged")
          TransferStore.initializeAndStage(context, spec, uri)
        } else if (state.status == TransferStatus.FAILED) {
          TransferStore.writeState(context, transferId, state.copy(
            status = TransferStatus.QUEUED,
            errorCode = null,
            updatedAt = System.currentTimeMillis(),
          ))
        }
        enqueueUploadWork(context, spec)
        notifyTransferChanged(context, transferId)
        TransferStore.snapshot(context, transferId)
    }.runOnQueue(ioScope)

    AsyncFunction("retryTransfer") { transferId: String ->
        val context = requireApplicationContext()
        val spec = TransferStore.readSpec(context, transferId) ?: error("Transfer not found")
        val state = TransferStore.readState(context, transferId) ?: error("Transfer state not found")
        require(state.status == TransferStatus.FAILED) { "Only a failed transfer can be retried" }
        require(spec.capability.isNotEmpty() && spec.expiresAt > System.currentTimeMillis() + 30_000L) { "Upload session has expired" }
        require(TransferStore.source(context, transferId).let { it.isFile && it.length() == spec.declaredBytes }) { "Staged source is unavailable" }
        TransferStore.writeState(context, transferId, state.copy(
          status = TransferStatus.QUEUED,
          errorCode = null,
          updatedAt = System.currentTimeMillis(),
        ))
        enqueueUploadWork(context, spec, replace = true)
        notifyTransferChanged(context, transferId)
        TransferStore.snapshot(context, transferId)
    }.runOnQueue(ioScope)

    AsyncFunction("removeTransfer") { transferId: String ->
      TransferStore.remove(requireApplicationContext(), transferId)
    }.runOnQueue(ioScope)
  }

  private fun applicationContext(): Context? = appContext.reactContext?.applicationContext
  private fun requireApplicationContext(): Context = applicationContext() ?: error("Android application context is unavailable")
}

private fun Map<String, Any?>.requiredString(key: String): String =
  (this[key] as? String)?.takeIf(String::isNotBlank) ?: throw IllegalArgumentException("Missing $key")

private fun Map<String, Any?>.requiredLong(key: String): Long =
  (this[key] as? Number)?.toLong() ?: throw IllegalArgumentException("Missing $key")

private fun Map<String, Any?>.requiredInt(key: String): Int =
  (this[key] as? Number)?.toInt() ?: throw IllegalArgumentException("Missing $key")
