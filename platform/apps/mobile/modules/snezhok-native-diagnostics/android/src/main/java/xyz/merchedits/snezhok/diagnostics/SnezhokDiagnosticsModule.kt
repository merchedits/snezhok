package xyz.merchedits.snezhok.diagnostics

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

class SnezhokDiagnosticsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SnezhokDiagnostics")

    Function("installCrashHandler") {
      val context = appContext.reactContext?.applicationContext ?: return@Function false
      installCrashHandler(context)
      true
    }

    AsyncFunction("consumeLastNativeCrash") {
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction null
      val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
      val value = preferences.getString(LAST_CRASH, null)
      if (value != null) preferences.edit().remove(LAST_CRASH).commit()
      value
    }

    AsyncFunction("getHistoricalExitReasons") { requestedLimit: Int ->
      val context = appContext.reactContext?.applicationContext ?: return@AsyncFunction emptyList<Map<String, Any?>>()
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return@AsyncFunction emptyList<Map<String, Any?>>()
      val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      manager.getHistoricalProcessExitReasons(context.packageName, 0, requestedLimit.coerceIn(1, 20)).map { exit ->
        mapOf(
          "reason" to reasonName(exit.reason),
          "reasonCode" to exit.reason,
          "timestamp" to exit.timestamp.toDouble(),
          "importance" to exit.importance,
          "pssKb" to exit.pss.toDouble(),
          "rssKb" to exit.rss.toDouble(),
          "description" to sanitize(exit.description, 240),
        )
      }
    }
  }

  private fun installCrashHandler(context: Context) {
    synchronized(CRASH_HANDLER_LOCK) {
      if (crashHandlerInstalled) return
      val previous = Thread.getDefaultUncaughtExceptionHandler()
      Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
        try {
          val frame = throwable.stackTrace.firstOrNull { it.className.startsWith("xyz.merchedits.snezhok") }
            ?: throwable.stackTrace.firstOrNull()
          val payload = JSONObject()
            .put("recordedAt", System.currentTimeMillis())
            .put("thread", sanitize(thread.name, 80))
            .put("type", sanitize(throwable.javaClass.name, 160))
            .put("frame", frame?.let { sanitize("${it.className}.${it.methodName}", 240) })
          context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(LAST_CRASH, payload.toString()).commit()
        } catch (_: Throwable) {
          // Crash capture must never prevent Android's normal crash handler.
        } finally {
          previous?.uncaughtException(thread, throwable)
        }
      }
      crashHandlerInstalled = true
    }
  }

  private fun reasonName(reason: Int): String = when (reason) {
    1 -> "exit-self"
    2 -> "signaled"
    3 -> "low-memory"
    4 -> "java-crash"
    5 -> "native-crash"
    6 -> "anr"
    7 -> "initialization-failure"
    8 -> "permission-change"
    9 -> "excessive-resource-usage"
    10 -> "user-requested"
    11 -> "user-stopped"
    12 -> "dependency-died"
    13 -> "other"
    14 -> "freezer"
    15 -> "package-state-change"
    16 -> "package-updated"
    else -> "unknown"
  }

  private fun sanitize(value: String?, maximum: Int): String? = value
    ?.replace(Regex("[\\r\\n\\t]+"), " ")
    ?.take(maximum)

  companion object {
    private const val PREFERENCES = "snezhok_native_diagnostics"
    private const val LAST_CRASH = "last_native_crash"
    private val CRASH_HANDLER_LOCK = Any()
    @Volatile private var crashHandlerInstalled = false
  }
}
