package xyz.merchedits.snezhok.calls

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.ToneGenerator
import android.net.Uri
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest

class SnezhokCallServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SnezhokCallService")

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
  }

  private fun applicationContext(): Context? = appContext.reactContext?.applicationContext

  private companion object {
    const val DEFAULT_HASH_BUFFER_BYTES = 64 * 1024
  }

  private fun serviceIntent(context: Context, action: String, title: String, body: String, videoEnabled: Boolean) =
    Intent(context, SnezhokCallForegroundService::class.java)
      .setAction(action)
      .putExtra(SnezhokCallForegroundService.EXTRA_TITLE, title.take(80))
      .putExtra(SnezhokCallForegroundService.EXTRA_BODY, body.take(120))
      .putExtra(SnezhokCallForegroundService.EXTRA_VIDEO, videoEnabled)
}
