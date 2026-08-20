package xyz.merchedits.snezhok.benchmark

import android.os.Build
import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {
    @get:Rule
    val baselineProfileRule = BaselineProfileRule()

    @Test
    fun startupAndOpenChat() {
        assumeTrue(
            "Baseline Profile collection requires Android 13 or newer on a non-rooted device",
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU,
        )
        baselineProfileRule.collect(
            packageName = PACKAGE_NAME,
            includeInStartupProfile = true,
        ) {
            pressHome()
            startActivityAndWait()
            device.waitForIdle()

            // A benchmark device can retain a private test login. When it is signed
            // in, exercise the hottest inbox -> chat path; signed-out runs still
            // produce a valid startup profile.
            (device.findObject(By.res(PACKAGE_NAME, SAVED_MESSAGES_ID))
                ?: device.findObject(By.text(SAVED_MESSAGES)))?.let { saved ->
                saved.click()
                device.waitForIdle()
                val x = device.displayWidth / 2
                val top = device.displayHeight / 3
                val bottom = device.displayHeight * 3 / 4
                repeat(3) { device.swipe(x, top, x, bottom, 10) }
                repeat(3) { device.swipe(x, bottom, x, top, 10) }
                device.pressBack()
                device.waitForIdle()
            }
        }
    }

    private companion object {
        const val PACKAGE_NAME = "xyz.merchedits.snezhok"
        const val SAVED_MESSAGES_ID = "conversation_saved"
        const val SAVED_MESSAGES = "\u0421\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f"
    }
}
