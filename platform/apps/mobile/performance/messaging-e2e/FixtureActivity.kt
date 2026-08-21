package xyz.merchedits.snezhok.e2e

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.view.View

/** A content-free frame used to generate a deterministic private-safe MP4. */
class FixtureActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(View(this).apply { setBackgroundColor(Color.rgb(126, 75, 255)) })
    }
}
