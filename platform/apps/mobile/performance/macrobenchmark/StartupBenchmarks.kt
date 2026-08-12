package xyz.merchedits.snezhok.benchmark

import androidx.benchmark.macro.BaselineProfileMode
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.FrameTimingMetric
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
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
        openSavedMessages()
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
        openSavedMessages()
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
        checkNotNull(device.findObject(By.desc(ATTACH_FILE))).click()
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
        val composer = device.findObject(By.text(MESSAGE_RU))
            ?: device.findObject(By.text(MESSAGE_EN))
            ?: error("Could not find the chat composer")
        composer.click()
        device.waitForIdle()
        device.pressBack()
        device.waitForIdle()
    }

    private fun chatIsOpen(): Boolean = device.hasObject(By.desc(ATTACH_FILE_RU))
        || device.hasObject(By.desc(ATTACH_FILE_EN))

    private fun returnToInboxIfChatIsOpen() {
        if (chatIsOpen()) {
            device.pressBack()
            device.waitForIdle()
        }
    }

    private fun openSavedMessages() {
        val saved = device.findObject(By.text(SAVED_MESSAGES_RU))
            ?: device.findObject(By.text(SAVED_MESSAGES_EN))
            ?: error("Sign the benchmark device into Snezhok before running chat benchmarks")
        saved.click()
        check(device.wait(Until.hasObject(By.desc(ATTACH_FILE_RU)), UI_TIMEOUT_MS)
            || device.wait(Until.hasObject(By.desc(ATTACH_FILE_EN)), UI_TIMEOUT_MS)) {
            "Chat did not become interactive within the benchmark timeout"
        }
    }

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
        const val SAVED_MESSAGES_RU = "\u0421\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f"
        const val SAVED_MESSAGES_EN = "Saved Messages"
        const val ATTACH_FILE_RU = "\u041f\u0440\u0438\u043a\u0440\u0435\u043f\u0438\u0442\u044c \u0444\u0430\u0439\u043b"
        const val ATTACH_FILE_EN = "Attach file"
        const val MESSAGE_RU = "\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435"
        const val MESSAGE_EN = "Message"
        const val UI_TIMEOUT_MS = 5_000L
    }
}
