package xyz.merchedits.snezhok.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.util.UUID
import kotlin.math.max
import kotlin.math.roundToInt

class SnezhokMediaCompressorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SnezhokMediaCompressor")

    AsyncFunction("compressJpeg") { uri: String, requestedLongEdge: Int, requestedQuality: Int ->
      val context = appContext.reactContext?.applicationContext
        ?: throw IllegalStateException("Android context is unavailable")
      compress(context, uri, requestedLongEdge.coerceIn(640, 4096), requestedQuality.coerceIn(45, 96))
    }
  }

  private fun compress(context: Context, uri: String, maximumLongEdge: Int, quality: Int): Map<String, Any> {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    openInput(context, uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalArgumentException("The selected image cannot be decoded")

    var sampleSize = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sampleSize * 2) >= maximumLongEdge) sampleSize *= 2
    val decoded = openInput(context, uri).use {
      BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply {
        inSampleSize = sampleSize
        inPreferredConfig = Bitmap.Config.ARGB_8888
      })
    } ?: throw IllegalArgumentException("The selected image cannot be decoded")

    val orientation = runCatching {
      openInput(context, uri).use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    val oriented = orient(decoded, orientation)
    if (oriented !== decoded) decoded.recycle()
    val scale = (maximumLongEdge.toFloat() / max(oriented.width, oriented.height)).coerceAtMost(1f)
    val scaled = if (scale < 1f) Bitmap.createScaledBitmap(oriented, (oriented.width * scale).roundToInt(), (oriented.height * scale).roundToInt(), true) else oriented
    if (scaled !== oriented) oriented.recycle()

    val opaque = Bitmap.createBitmap(scaled.width, scaled.height, Bitmap.Config.ARGB_8888)
    opaque.setHasAlpha(false)
    Canvas(opaque).apply {
      drawColor(Color.WHITE)
      drawBitmap(scaled, 0f, 0f, null)
    }
    if (opaque !== scaled) scaled.recycle()

    val directory = File(context.cacheDir, "snezhok-media").apply { mkdirs() }
    val output = File(directory, "${UUID.randomUUID()}.jpg")
    try {
      output.outputStream().buffered().use { stream ->
        if (!opaque.compress(Bitmap.CompressFormat.JPEG, quality, stream)) throw IllegalStateException("Image compression failed")
      }
      return mapOf(
        "uri" to Uri.fromFile(output).toString(),
        "width" to opaque.width,
        "height" to opaque.height,
      )
    } catch (error: Throwable) {
      output.delete()
      throw error
    } finally {
      opaque.recycle()
    }
  }

  private fun openInput(context: Context, value: String): InputStream {
    val uri = Uri.parse(value)
    return when (uri.scheme) {
      null -> FileInputStream(value)
      "file" -> FileInputStream(uri.path ?: throw IllegalArgumentException("Invalid file URI"))
      else -> context.contentResolver.openInputStream(uri) ?: throw IllegalArgumentException("The selected image is unavailable")
    }
  }

  private fun orient(source: Bitmap, orientation: Int): Bitmap {
    val matrix = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
      ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> { matrix.setRotate(180f); matrix.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
      ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.setRotate(-90f); matrix.postScale(-1f, 1f) }
      ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
      else -> return source
    }
    return Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
  }
}
