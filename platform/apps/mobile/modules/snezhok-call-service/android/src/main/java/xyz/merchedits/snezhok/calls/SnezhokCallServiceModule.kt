package xyz.merchedits.snezhok.calls

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.media.AudioManager
import android.media.ToneGenerator
import android.net.Uri
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.security.MessageDigest
import kotlin.math.min

class SnezhokCallServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SnezhokCallService")
    Events(UPDATE_DOWNLOAD_EVENT)

    Function("start") { title: String, body: String, videoEnabled: Boolean ->
      val context = applicationContext() ?: return@Function false
      try {
        ContextCompat.startForegroundService(context, serviceIntent(context, SnezhokCallForegroundService.ACTION_START, title, body, videoEnabled))
        true
      } catch (_: RuntimeException) {
        // Android 12+ rejects foreground-service starts from ineligible
        // background states. Report failure to JS so it does not open media
        // without the service required to keep microphone/camera use legal.
        false
      }
    }

    Function("update") { title: String, body: String, videoEnabled: Boolean ->
      val context = applicationContext() ?: return@Function false
      try {
        context.startService(serviceIntent(context, SnezhokCallForegroundService.ACTION_UPDATE, title, body, videoEnabled))
        true
      } catch (_: RuntimeException) {
        false
      }
    }

    Function("stop") {
      val context = applicationContext() ?: return@Function false
      context.stopService(Intent(context, SnezhokCallForegroundService::class.java))
    }

    Function("playOutputTest") {
      val generator = ToneGenerator(AudioManager.STREAM_VOICE_CALL, 55)
      val started = generator.startTone(ToneGenerator.TONE_PROP_BEEP2, 350)
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ generator.release() }, 500)
      started
    }

    AsyncFunction("sha256File") { uri: String ->
      val context = applicationContext() ?: throw IllegalStateException("Android application context is unavailable")
      val digest = MessageDigest.getInstance("SHA-256")
      context.contentResolver.openInputStream(Uri.parse(uri)).use { input ->
        requireNotNull(input) { "Cannot open the downloaded update" }
        val buffer = ByteArray(DEFAULT_HASH_BUFFER_BYTES)
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          if (count > 0) digest.update(buffer, 0, count)
        }
      }
      digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
    }

    AsyncFunction("downloadUpdate") Coroutine {
        urls: List<String>,
        destinationUri: String,
        expectedBytesValue: Double,
        expectedSha256: String ->
      withContext(Dispatchers.IO) {
        val context = applicationContext() ?: throw IllegalStateException("Android application context is unavailable")
        val expectedBytes = expectedBytesValue.toLong()
        require(expectedBytes in MIN_UPDATE_BYTES..MAX_UPDATE_BYTES) { "Invalid update byte count" }
        require(SHA256_PATTERN.matches(expectedSha256)) { "Invalid update digest" }

        require(urls.isNotEmpty() && urls.size <= MAX_DOWNLOAD_SOURCES) { "Invalid update sources" }
        urls.forEach { source ->
          val remoteUri = URI(source)
          require(remoteUri.scheme.equals("https", ignoreCase = true) && !remoteUri.host.isNullOrBlank()) {
            "Updates must use HTTPS"
          }
        }
        val destination = requireCacheApk(context, destinationUri)
        val partial = File("${destination.absolutePath}.part")
        destination.parentFile?.mkdirs()

        if (destination.isFile && destination.length() == expectedBytes) {
          emitUpdateProgress(destinationUri, "verifying", expectedBytes, expectedBytes, 0)
          val digest = sha256(destination)
          if (digest == expectedSha256) {
            return@withContext mapOf("uri" to Uri.fromFile(destination).toString(), "bytes" to expectedBytes.toDouble(), "sha256" to digest)
          }
          destination.delete()
        }
        if (partial.exists() && (!partial.isFile || partial.length() > expectedBytes)) partial.delete()

        downloadWithResume(urls.distinct(), destinationUri, partial, expectedBytes)
        emitUpdateProgress(destinationUri, "verifying", expectedBytes, expectedBytes, 0)
        val digest = sha256(partial)
        if (digest != expectedSha256) {
          partial.delete()
          throw IOException("Downloaded update failed integrity verification")
        }

        if (destination.exists() && !destination.delete()) throw IOException("Cannot replace the previous update")
        if (!partial.renameTo(destination)) throw IOException("Cannot finalize the downloaded update")
        mapOf("uri" to Uri.fromFile(destination).toString(), "bytes" to expectedBytes.toDouble(), "sha256" to digest)
      }
    }

    AsyncFunction("installUpdate") Coroutine {
        destinationUri: String,
        expectedBytesValue: Double,
        expectedSha256: String ->
      val context = applicationContext() ?: throw IllegalStateException("Android application context is unavailable")
      val expectedBytes = expectedBytesValue.toLong()
      require(expectedBytes in MIN_UPDATE_BYTES..MAX_UPDATE_BYTES) { "Invalid update byte count" }
      require(SHA256_PATTERN.matches(expectedSha256)) { "Invalid update digest" }
      val apk = requireCacheApk(context, destinationUri)

      withContext(Dispatchers.IO) {
        if (!apk.isFile || apk.length() != expectedBytes || sha256(apk) != expectedSha256) {
          apk.delete()
          throw IOException("Downloaded update is no longer valid")
        }
      }

      withContext(Dispatchers.Main) {
        requestUpdateInstallation(context, apk)
      }
    }
  }

  private fun requestUpdateInstallation(context: Context, apk: File): Map<String, String> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
      val opened = launchExternalActivity(
        context,
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")),
      )
      return mapOf("status" to if (opened) "permission-required" else "settings-unavailable")
    }

    val contentUri = FileProvider.getUriForFile(
      context,
      "${context.packageName}.FileSystemFileProvider",
      apk,
    )
    val installerIntents = listOf(
      Intent(Intent.ACTION_INSTALL_PACKAGE),
      Intent(Intent.ACTION_VIEW),
    )
    installerIntents.forEach { intent ->
      intent.setDataAndType(contentUri, APK_MIME_TYPE)
      intent.clipData = ClipData.newRawUri("Snezhok update", contentUri)
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      intent.putExtra(Intent.EXTRA_RETURN_RESULT, false)
      if (launchExternalActivity(context, intent)) return mapOf("status" to "launched")
    }

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      val opened = launchExternalActivity(context, Intent(Settings.ACTION_SECURITY_SETTINGS))
      if (opened) return mapOf("status" to "permission-required")
    }
    return mapOf("status" to "installer-unavailable")
  }

  private fun launchExternalActivity(context: Context, intent: Intent): Boolean {
    return try {
      val activity = appContext.currentActivity
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
      true
    } catch (_: ActivityNotFoundException) {
      false
    } catch (_: SecurityException) {
      false
    }
  }

  private suspend fun downloadWithResume(urls: List<String>, destinationUri: String, partial: File, expectedBytes: Long) {
    var attempt = 0
    var lastError: IOException? = null
    while (partial.length() < expectedBytes && attempt < MAX_DOWNLOAD_ATTEMPTS) {
      attempt += 1
      val offset = partial.length()
      emitUpdateProgress(destinationUri, if (attempt == 1) "downloading" else "retrying", offset, expectedBytes, attempt)
      try {
        val url = urls[(attempt - 1) % urls.size]
        downloadAttempt(url, destinationUri, partial, expectedBytes, offset, attempt)
        lastError = null
      } catch (error: IOException) {
        lastError = error
        if (attempt >= MAX_DOWNLOAD_ATTEMPTS) break
        emitUpdateProgress(destinationUri, "retrying", partial.length(), expectedBytes, attempt)
        delay(min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (1L shl min(attempt - 1, 4))))
      }
    }
    if (partial.length() != expectedBytes) {
      throw IOException("Update download was interrupted after ${partial.length()} of $expectedBytes bytes", lastError)
    }
  }

  private fun downloadAttempt(
    url: String,
    destinationUri: String,
    partial: File,
    expectedBytes: Long,
    requestedOffset: Long,
    attempt: Int,
  ) {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = CONNECT_TIMEOUT_MS
      readTimeout = READ_TIMEOUT_MS
      instanceFollowRedirects = true
      requestMethod = "GET"
      setRequestProperty("Accept", "application/vnd.android.package-archive")
      setRequestProperty("Accept-Encoding", "identity")
      setRequestProperty("Cache-Control", "no-transform")
      if (requestedOffset > 0L) setRequestProperty("Range", "bytes=$requestedOffset-")
    }
    try {
      val status = connection.responseCode
      if (status == HTTP_RANGE_NOT_SATISFIABLE && requestedOffset == expectedBytes) return
      if (status != HttpURLConnection.HTTP_OK && status != HttpURLConnection.HTTP_PARTIAL) {
        throw IOException("Update server returned HTTP $status")
      }

      var writeOffset = requestedOffset
      if (requestedOffset > 0L) {
        if (status == HttpURLConnection.HTTP_OK) {
          writeOffset = 0L
        } else {
          val range = parseContentRange(connection.getHeaderField("Content-Range"))
            ?: throw IOException("Update server returned an invalid Content-Range")
          if (range.first != requestedOffset || range.second != expectedBytes) {
            throw IOException("Update server resumed from an unexpected byte")
          }
        }
      } else if (status == HttpURLConnection.HTTP_PARTIAL) {
        val range = parseContentRange(connection.getHeaderField("Content-Range"))
          ?: throw IOException("Update server returned an invalid Content-Range")
        if (range.first != 0L || range.second != expectedBytes) throw IOException("Update server returned an unexpected range")
      }

      RandomAccessFile(partial, "rw").use { output ->
        if (writeOffset == 0L) output.setLength(0L)
        output.seek(writeOffset)
        connection.inputStream.buffered(DOWNLOAD_BUFFER_BYTES).use { input ->
          val buffer = ByteArray(DOWNLOAD_BUFFER_BYTES)
          var total = writeOffset
          var lastEventAt = 0L
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (count == 0) continue
            if (total + count > expectedBytes) throw IOException("Update server sent more bytes than declared")
            output.write(buffer, 0, count)
            total += count
            val now = System.currentTimeMillis()
            if (now - lastEventAt >= PROGRESS_EVENT_INTERVAL_MS || total == expectedBytes) {
              lastEventAt = now
              emitUpdateProgress(destinationUri, "downloading", total, expectedBytes, attempt)
            }
          }
        }
        output.fd.sync()
      }
    } finally {
      connection.disconnect()
    }
  }

  private fun emitUpdateProgress(destinationUri: String, phase: String, bytes: Long, total: Long, attempt: Int) {
    sendEvent(UPDATE_DOWNLOAD_EVENT, mapOf(
      "destinationUri" to destinationUri,
      "phase" to phase,
      "bytesWritten" to bytes.toDouble(),
      "totalBytes" to total.toDouble(),
      "attempt" to attempt,
    ))
  }

  private fun requireCacheApk(context: Context, uri: String): File {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file") { "Update destination must be a local file" }
    val file = File(requireNotNull(parsed.path) { "Update destination is invalid" }).canonicalFile
    val cache = context.cacheDir.canonicalFile
    require(file.path.startsWith(cache.path + File.separator) && file.name.endsWith(".apk")) {
      "Update destination must be an APK in the application cache"
    }
    return file
  }

  private fun parseContentRange(value: String?): Pair<Long, Long>? {
    val match = value?.let(CONTENT_RANGE_PATTERN::matchEntire) ?: return null
    val start = match.groupValues[1].toLongOrNull() ?: return null
    val total = match.groupValues[3].toLongOrNull() ?: return null
    return start to total
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().buffered(HASH_BUFFER_BYTES).use { input ->
      val buffer = ByteArray(HASH_BUFFER_BYTES)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        if (count > 0) digest.update(buffer, 0, count)
      }
    }
    return digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
  }

  private fun applicationContext(): Context? = appContext.reactContext?.applicationContext

  private companion object {
    const val UPDATE_DOWNLOAD_EVENT = "onUpdateDownloadProgress"
    const val APK_MIME_TYPE = "application/vnd.android.package-archive"
    const val DEFAULT_HASH_BUFFER_BYTES = 64 * 1024
    const val HASH_BUFFER_BYTES = 1024 * 1024
    const val DOWNLOAD_BUFFER_BYTES = 256 * 1024
    const val CONNECT_TIMEOUT_MS = 15_000
    const val READ_TIMEOUT_MS = 30_000
    const val PROGRESS_EVENT_INTERVAL_MS = 200L
    const val MAX_DOWNLOAD_ATTEMPTS = 12
    const val MAX_DOWNLOAD_SOURCES = 4
    const val BASE_RETRY_DELAY_MS = 500L
    const val MAX_RETRY_DELAY_MS = 8_000L
    const val MIN_UPDATE_BYTES = 1024L * 1024L
    const val MAX_UPDATE_BYTES = 500L * 1024L * 1024L
    const val HTTP_RANGE_NOT_SATISFIABLE = 416
    val SHA256_PATTERN = Regex("^[0-9a-f]{64}$")
    val CONTENT_RANGE_PATTERN = Regex("^bytes (\\d+)-(\\d+)/(\\d+)$")
  }

  private fun serviceIntent(context: Context, action: String, title: String, body: String, videoEnabled: Boolean) =
    Intent(context, SnezhokCallForegroundService::class.java)
      .setAction(action)
      .putExtra(SnezhokCallForegroundService.EXTRA_TITLE, title.take(80))
      .putExtra(SnezhokCallForegroundService.EXTRA_BODY, body.take(120))
      .putExtra(SnezhokCallForegroundService.EXTRA_VIDEO, videoEnabled)
}
