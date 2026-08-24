package xyz.merchedits.snezhok.e2e

import android.app.Activity
import android.content.ContentValues
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.view.View

/** A content-free frame used to generate a deterministic private-safe MP4. */
class FixtureActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        installPhotoFixture()
        setContentView(View(this).apply { setBackgroundColor(Color.rgb(126, 75, 255)) })
    }

    private fun installPhotoFixture() {
        val now = System.currentTimeMillis()
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, PHOTO_FILENAME)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.DATE_TAKEN, now)
            put(MediaStore.Images.Media.DATE_ADDED, now / 1_000)
            put(MediaStore.Images.Media.DATE_MODIFIED, now / 1_000)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/SnezhokE2E")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
        }
        val uri = checkNotNull(contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)) {
            "Could not insert the private-safe photo fixture"
        }
        contentResolver.openOutputStream(uri, "w").use { output ->
            checkNotNull(output) { "Could not open the private-safe photo fixture" }
            resources.openRawResource(R.raw.snezhok_e2e_photo).use { input -> input.copyTo(output) }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            contentResolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
        }
    }

    private companion object {
        const val PHOTO_FILENAME = "snezhok-e2e-photo.png"
    }
}
