package xyz.merchedits.snezhok.benchmark

import androidx.benchmark.macro.BaselineProfileMode
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.MacrobenchmarkScope
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import android.os.SystemClock
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StartupBenchmarks {
    @get:Rule
    val benchmarkRule = MacrobenchmarkRule()

    @Test
    fun coldStartupWithoutProfile() = measure(CompilationMode.None())

    @Test
    fun coldStartupWithProfile() = measure(CompilationMode.Partial(BaselineProfileMode.Require))

    @Test
    fun inboxToSavedMessages() = benchmarkRule.measureRepeated(
        packageName = PACKAGE_NAME,
        metrics = listOf(FrameTimingMetric()),
        compilationMode = CompilationMode.Partial(BaselineProfileMode.UseIfAvailable),
        iterations = 10,
        setupBlock = {
            pressHome()
            startActivityAndWait()
            device.waitForIdle()
            returnToInboxIfChatIsOpen()
        },
    ) {
        openSavedMessages(COLD_CACHED_CHAT_BUDGET_MS)
    }

    @Test
    fun warmCachedChatReopen() = benchmarkRule.measureRepeated(
        packageName = PACKAGE_NAME,
        metrics = listOf(FrameTimingMetric()),
        compilationMode = CompilationMode.Partial(BaselineProfileMode.UseIfAvailable),
        iterations = 10,
        setupBlock = {
            pressHome()
            startActivityAndWait()
            device.waitForIdle()
            // Populate the in-memory projection once, then return to the inbox.
            // Subsequent measured opens exercise the actual warm-reopen path.
            if (!chatIsOpen()) openSavedMessages()
            device.pressBack()
            device.waitForIdle()
        },
    ) {
        openSavedMessages(WARM_CACHED_CHAT_BUDGET_MS)
    }

    @Test
    fun messageListScroll() = benchmarkRule.measureRepeated(
        packageName = PACKAGE_NAME,
        metrics = listOf(FrameTimingMetric()),
        compilationMode = CompilationMode.Partial(BaselineProfileMode.UseIfAvailable),
        iterations = 10,
        setupBlock = {
            pressHome()
            startActivityAndWait()
            device.waitForIdle()
            if (!chatIsOpen()) openSavedMessages()
        },
    ) {
        val x = device.displayWidth / 2
        val top = device.displayHeight / 3
        val bottom = device.displayHeight * 3 / 4
        repeat(5) { device.swipe(x, top, x, bottom, 10) }
        repeat(5) { device.swipe(x, bottom, x, top, 10) }
        device.waitForIdle()
    }

    @Test
    fun attachmentDrawerScroll() = benchmarkRule.measureRepeated(
        packageName = PACKAGE_NAME,
        metrics = listOf(FrameTimingMetric()),
        compilationMode = CompilationMode.Partial(BaselineProfileMode.UseIfAvailable),
        iterations = 10,
        setupBlock = {
            pressHome()
            startActivityAndWait()
            device.waitForIdle()
            if (!chatIsOpen()) openSavedMessages()
        },
    ) {
        val startedAt = SystemClock.elapsedRealtime()
        checkNotNull(device.findObject(By.res(PACKAGE_NAME, CHAT_ATTACH_ID))
            ?: device.findObject(By.desc(ATTACH_FILE_RU))
            ?: device.findObject(By.desc(ATTACH_FILE_EN))).click()
        check(device.wait(Until.hasObject(By.res(PACKAGE_NAME, ATTACHMENT_SHEET_ID)), UI_TIMEOUT_MS)) {
            "Attachment sheet did not become interactive within the benchmark timeout"
        }
        check(SystemClock.elapsedRealtime() - startedAt <= ATTACHMENT_DRAWER_BUDGET_MS) {
            "Attachment sheet exceeded the ${ATTACHMENT_DRAWER_BUDGET_MS} ms interaction budget"
        }
        device.waitForIdle()
        val x = device.displayWidth / 2
        val top = device.displayHeight / 2
        val bottom = device.displayHeight * 4 / 5
        repeat(4) { device.swipe(x, bottom, x, top, 10) }
        repeat(4) { device.swipe(x, top, x, bottom, 10) }
        device.pressBack()
    }

    @Test
    fun composerKeyboardTransition() = benchmarkRule.measureRepeated(
        packageName = PACKAGE_NAME,
        metrics = listOf(FrameTimingMetric()),
        compilationMode = CompilationMode.Partial(BaselineProfileMode.UseIfAvailable),
        iterations = 10,
        setupBlock = {
            pressHome()
            startActivityAndWait()
            device.waitForIdle()
            if (!chatIsOpen()) openSavedMessages()
        },
    ) {
        val composer = device.findObject(By.res(PACKAGE_NAME, CHAT_COMPOSER_ID))
            ?: device.findObject(By.text(MESSAGE_RU))
            ?: device.findObject(By.text(MESSAGE_EN))
            ?: error("Could not find the chat composer")
        composer.click()
        device.waitForIdle()
        device.pressBack()
        device.waitForIdle()
    }

    private fun MacrobenchmarkScope.chatIsOpen(): Boolean = device.hasObject(By.res(PACKAGE_NAME, CHAT_TIMELINE_ID))
        || device.hasObject(By.desc(ATTACH_FILE_RU))
        || device.hasObject(By.desc(ATTACH_FILE_EN))

    private fun MacrobenchmarkScope.returnToInboxIfChatIsOpen() {
        if (chatIsOpen()) {
            device.pressBack()
            device.waitForIdle()
        }
    }

    private fun MacrobenchmarkScope.openSavedMessages(maximumDurationMs: Long = UI_TIMEOUT_MS) {
        val saved = awaitSavedMessages()
        val startedAt = SystemClock.elapsedRealtime()
        saved.click()
        check(device.wait(Until.hasObject(By.res(PACKAGE_NAME, CHAT_TIMELINE_ID)), UI_TIMEOUT_MS)
            || device.wait(Until.hasObject(By.desc(ATTACH_FILE_RU)), UI_TIMEOUT_MS)
            || device.wait(Until.hasObject(By.desc(ATTACH_FILE_EN)), UI_TIMEOUT_MS)) {
            "Chat did not become interactive within the benchmark timeout"
        }
        check(SystemClock.elapsedRealtime() - startedAt <= maximumDurationMs) {
            "Chat interaction exceeded the $maximumDurationMs ms budget"
        }
    }

    private fun MacrobenchmarkScope.awaitSavedMessages(): UiObject2 {
        val deadline = SystemClock.elapsedRealtime() + INBOX_READY_TIMEOUT_MS
        do {
            findSavedMessages()?.let { return it }
            SystemClock.sleep(INBOX_READY_POLL_MS)
        } while (SystemClock.elapsedRealtime() < deadline)
        error("Snezhok inbox did not expose Saved Messages within the benchmark readiness timeout")
    }

    private fun MacrobenchmarkScope.findSavedMessages(): UiObject2? =
        device.findObject(By.res(PACKAGE_NAME, SAVED_MESSAGES_ID))
            ?: device.findObject(By.text(SAVED_MESSAGES_RU))
            ?: device.findObject(By.text(SAVED_MESSAGES_EN))

    private fun measure(compilationMode: CompilationMode) = benchmarkRule.measureRepeated(
        packageName = PACKAGE_NAME,
        metrics = listOf(StartupTimingMetric()),
        compilationMode = compilationMode,
        startupMode = StartupMode.COLD,
        iterations = 10,
        setupBlock = { pressHome() },
    ) {
        startActivityAndWait()
    }

    private companion object {
        const val PACKAGE_NAME = "xyz.merchedits.snezhok"
        const val SAVED_MESSAGES_ID = "conversation_saved"
        const val CHAT_TIMELINE_ID = "chat_timeline"
        const val CHAT_ATTACH_ID = "chat_attach"
        const val CHAT_COMPOSER_ID = "chat_composer"
        const val ATTACHMENT_SHEET_ID = "attachment_sheet"
        const val SAVED_MESSAGES_RU = "\u0421\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f"
        const val SAVED_MESSAGES_EN = "Saved Messages"
        const val ATTACH_FILE_RU = "\u041f\u0440\u0438\u043a\u0440\u0435\u043f\u0438\u0442\u044c \u0444\u0430\u0439\u043b"
        const val ATTACH_FILE_EN = "Attach file"
        const val MESSAGE_RU = "\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435"
        const val MESSAGE_EN = "Message"
        const val UI_TIMEOUT_MS = 5_000L
        const val INBOX_READY_TIMEOUT_MS = 10_000L
        const val INBOX_READY_POLL_MS = 50L
        const val WARM_CACHED_CHAT_BUDGET_MS = 150L
        const val COLD_CACHED_CHAT_BUDGET_MS = 350L
        const val ATTACHMENT_DRAWER_BUDGET_MS = 400L
    }
}
