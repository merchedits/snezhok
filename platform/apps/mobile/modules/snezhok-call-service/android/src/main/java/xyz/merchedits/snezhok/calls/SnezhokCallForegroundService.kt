package xyz.merchedits.snezhok.calls

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

class SnezhokCallForegroundService : Service() {
  private var title = "Snezhok"
  private var body = "Активный звонок"
  private var videoEnabled = false

  override fun onCreate() {
    super.onCreate()
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Активные звонки", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Управление активным звонком Snezhok"
        setSound(null, null)
        enableVibration(false)
        lockscreenVisibility = Notification.VISIBILITY_PRIVATE
      })
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_START, ACTION_UPDATE, null -> {
        title = intent?.getStringExtra(EXTRA_TITLE)?.takeIf { it.isNotBlank() } ?: title
        body = intent?.getStringExtra(EXTRA_BODY)?.takeIf { it.isNotBlank() } ?: body
        videoEnabled = intent?.getBooleanExtra(EXTRA_VIDEO, videoEnabled) ?: videoEnabled
        promote()
      }
    }
    // LiveKit owns the media connection. The service exists to keep Android's
    // microphone/camera execution contract satisfied, not to recreate calls
    // after the user explicitly kills the process.
    return START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun promote() {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    val pendingIntent = launchIntent?.let {
      PendingIntent.getActivity(this, 4102, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(title)
      .setContentText(body)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setContentIntent(pendingIntent)
      .build()
    val serviceTypes = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && videoEnabled) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    } else {
      0
    }
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, serviceTypes)
    } catch (_: SecurityException) {
      // A camera permission can be revoked between the JS check and this
      // service update. Preserve the audio call with the narrower legal type.
      val microphoneOnly = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, microphoneOnly)
      videoEnabled = false
    }
  }

  companion object {
    const val ACTION_START = "xyz.merchedits.snezhok.calls.START"
    const val ACTION_UPDATE = "xyz.merchedits.snezhok.calls.UPDATE"
    const val ACTION_STOP = "xyz.merchedits.snezhok.calls.STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    const val EXTRA_VIDEO = "video"
    private const val CHANNEL_ID = "active-calls-v1"
    private const val NOTIFICATION_ID = 4102
  }
}
