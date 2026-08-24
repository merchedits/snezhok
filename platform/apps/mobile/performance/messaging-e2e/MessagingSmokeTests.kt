package xyz.merchedits.snezhok.e2e

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.UiObject2
import androidx.test.uiautomator.Until
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.regex.Pattern

@RunWith(AndroidJUnit4::class)
class MessagingSmokeTests {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val device = UiDevice.getInstance(instrumentation)

    @Before
    fun openSavedMessages() {
        launchApp()
        dismissAttachmentSheetIfPresent()
        enterSavedMessages()
    }

    @Test
    fun sendTextForCacheProbe() {
        val marker = InstrumentationRegistry.getArguments().getString("textMarker")
            ?.takeIf { it.matches(Regex("snezhok-e2e-[0-9]{10,20}")) }
            ?: error("textMarker instrumentation argument is missing or unsafe")
        val committedBefore = resourceNames(MESSAGE_COMMITTED_PREFIX)
        val composer = requireObject(resource(CHAT_COMPOSER_ID), "chat composer")
        composer.text = marker
        requireObject(resource(CHAT_SEND_ID), "send button").click()
        awaitComposerCleared(marker)
        await(By.text(marker), MESSAGE_TIMEOUT_MS, "sent marker")
        awaitNewResource(MESSAGE_COMMITTED_PREFIX, committedBefore, MESSAGE_TIMEOUT_MS, "server-acknowledged text message")
        println("SNEZHOK_E2E text-send PASS")
    }

    @Test
    fun openSavedMessagesForCacheProbe() {
        val marker = InstrumentationRegistry.getArguments().getString("textMarker")
            ?.takeIf { it.matches(Regex("snezhok-e2e-[0-9]{10,20}")) }
            ?: error("textMarker instrumentation argument is missing or unsafe")
        check(device.hasObject(resource(CHAT_TIMELINE_ID))) { "Cached chat timeline is not visible" }
        await(By.text(marker), MESSAGE_TIMEOUT_MS, "cached text marker")
        println("SNEZHOK_E2E cache-open PASS")
    }

    @Test
    fun attachmentDrawerOpens() {
        requireObject(resource(CHAT_ATTACH_ID), "attachment button").click()
        val sheet = await(resource(ATTACHMENT_SHEET_ID), DRAWER_TIMEOUT_MS, "attachment drawer")
        tapBackdropAbove(sheet)
        check(device.wait(Until.gone(resource(ATTACHMENT_SHEET_ID)), DRAWER_TIMEOUT_MS)) {
            "Attachment drawer did not close"
        }
        println("SNEZHOK_E2E attachment-drawer PASS")
    }

    @Test
    fun sendPhotoAndOpenViewer() {
        val filename = InstrumentationRegistry.getArguments().getString("photoFilename")
            ?.takeIf { it.matches(Regex("[A-Za-z0-9._-]{1,120}")) }
            ?: error("photoFilename instrumentation argument is missing or unsafe")
        val before = resourceNames(MESSAGE_IMAGE_PREFIX)
        requireObject(resource(CHAT_ATTACH_ID), "attachment button").click()
        await(resource(ATTACHMENT_SHEET_ID), DRAWER_TIMEOUT_MS, "attachment drawer")
        await(By.desc(filename), MEDIA_DISCOVERY_TIMEOUT_MS, "prepared photo $filename").click()
        requireObject(resource(ATTACHMENT_SEND_ID), "attachment send button").click()
        check(device.wait(Until.gone(resource(ATTACHMENT_SHEET_ID)), UPLOAD_TIMEOUT_MS)) {
            "Attachment drawer stayed open after the upload timeout"
        }
        val photo = awaitNewResource(MESSAGE_IMAGE_PREFIX, before, UPLOAD_TIMEOUT_MS, "new image message")
        photo.click()
        val close = awaitAny(
            listOf(By.desc(CLOSE_PHOTO_RU), By.desc(CLOSE_PHOTO_EN)),
            VIEWER_TIMEOUT_MS,
            "photo viewer close action",
        )
        close.click()
        println("SNEZHOK_E2E photo-upload-viewer PASS")
    }

    @Test
    fun sendVideoAndOpenViewer() {
        val filename = InstrumentationRegistry.getArguments().getString("videoFilename")
            ?.takeIf { it.matches(Regex("[A-Za-z0-9._-]{1,120}")) }
            ?: error("videoFilename instrumentation argument is missing or unsafe")
        val before = resourceNames(MESSAGE_VIDEO_PREFIX)
        requireObject(resource(CHAT_ATTACH_ID), "attachment button").click()
        await(resource(ATTACHMENT_SHEET_ID), DRAWER_TIMEOUT_MS, "attachment drawer")
        await(By.desc(filename), MEDIA_DISCOVERY_TIMEOUT_MS, "prepared video $filename").click()
        requireObject(resource(ATTACHMENT_SEND_ID), "attachment send button").click()
        check(device.wait(Until.gone(resource(ATTACHMENT_SHEET_ID)), UPLOAD_TIMEOUT_MS)) {
            "Attachment drawer stayed open after the video upload timeout"
        }
        val video = awaitNewResource(MESSAGE_VIDEO_PREFIX, before, UPLOAD_TIMEOUT_MS, "new video message")
        video.click()
        val close = awaitAny(
            listOf(By.desc(CLOSE_VIDEO_RU), By.desc(CLOSE_VIDEO_EN)),
            VIEWER_TIMEOUT_MS,
            "video viewer close action",
        )
        close.click()
        println("SNEZHOK_E2E video-upload-viewer PASS")
    }

    @Test
    fun recordSendAndStartVoicePlayback() {
        val before = resourceNames(MESSAGE_VOICE_PREFIX)
        val voice = requireObject(resource(CHAT_VOICE_ID), "voice record button")
        val bounds = voice.visibleBounds
        check(device.swipe(bounds.centerX(), bounds.centerY(), bounds.centerX(), bounds.centerY(), VOICE_HOLD_STEPS)) {
            "Could not perform the voice recording gesture"
        }
        val sent = awaitNewResource(MESSAGE_VOICE_PREFIX, before, UPLOAD_TIMEOUT_MS, "new voice message")
        sent.click()
        check(device.hasObject(resourcePrefix(MESSAGE_VOICE_PREFIX))) { "Chat disappeared after voice playback started" }
        println("SNEZHOK_E2E voice-record-playback PASS")
    }

    private fun launchApp() {
        device.executeShellCommand("am force-stop $PACKAGE_NAME")
        val intent = context.packageManager.getLaunchIntentForPackage(PACKAGE_NAME)
            ?: error("Snezhok is not installed")
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        check(device.wait(Until.hasObject(By.pkg(PACKAGE_NAME).depth(0)), APP_START_TIMEOUT_MS)) {
            "Snezhok did not reach the foreground"
        }
    }

    private fun dismissAttachmentSheetIfPresent() {
        val sheet = device.findObject(resource(ATTACHMENT_SHEET_ID)) ?: return
        tapBackdropAbove(sheet)
        check(device.wait(Until.gone(resource(ATTACHMENT_SHEET_ID)), DRAWER_TIMEOUT_MS)) {
            "Could not recover from an attachment drawer left open by an earlier scenario"
        }
    }

    private fun tapBackdropAbove(sheet: UiObject2) {
        val top = sheet.visibleBounds.top
        check(top > 1) { "Attachment drawer leaves no tappable backdrop" }
        check(device.click(device.displayWidth / 2, maxOf(1, top / 2))) {
            "Could not tap the attachment backdrop"
        }
    }

    private fun enterSavedMessages(timeoutMs: Long = INBOX_TIMEOUT_MS) {
        check(device.wait(Until.hasObject(resource(E2E_PROTOCOL_ID)), timeoutMs)) {
            "Installed Snezhok does not expose messaging E2E protocol v1; install a candidate built from the current source"
        }
        if (device.wait(Until.hasObject(resource(CHAT_TIMELINE_ID)), SHORT_TIMEOUT_MS)) {
            device.pressBack()
        }
        if (!device.wait(Until.hasObject(resource(SAVED_MESSAGES_ID)), SHORT_TIMEOUT_MS)) {
            awaitAny(listOf(By.desc(CHATS_RU), By.desc(CHATS_EN)), timeoutMs, "Chats tab").click()
        }
        val saved = awaitAny(
            listOf(resource(SAVED_MESSAGES_ID), By.text(SAVED_MESSAGES_RU), By.text(SAVED_MESSAGES_EN)),
            timeoutMs,
            "Saved Messages row; sign in once before running the autonomous suite",
        )
        saved.click()
        await(resource(CHAT_TIMELINE_ID), minOf(timeoutMs, CHAT_OPEN_TIMEOUT_MS), "chat timeline")
    }

    private fun awaitComposerCleared(marker: String) {
        val deadline = SystemClock.elapsedRealtime() + SHORT_TIMEOUT_MS
        do {
            if (device.findObject(resource(CHAT_COMPOSER_ID))?.text != marker) return
            SystemClock.sleep(POLL_INTERVAL_MS)
        } while (SystemClock.elapsedRealtime() < deadline)
        error("Composer did not clear after Send")
    }

    private fun requireObject(selector: BySelector, description: String): UiObject2 =
        device.findObject(selector) ?: await(selector, SHORT_TIMEOUT_MS, description)

    private fun await(selector: BySelector, timeoutMs: Long, description: String): UiObject2 =
        checkNotNull(device.wait(Until.findObject(selector), timeoutMs)) { "Timed out waiting for $description" }

    private fun awaitAny(selectors: List<BySelector>, timeoutMs: Long, description: String): UiObject2 {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        do {
            selectors.firstNotNullOfOrNull { device.findObject(it) }?.let { return it }
            SystemClock.sleep(POLL_INTERVAL_MS)
        } while (SystemClock.elapsedRealtime() < deadline)
        error("Timed out waiting for $description")
    }

    private fun objects(selector: BySelector): List<UiObject2> =
        device.findObjects(selector) ?: emptyList()

    private fun resource(id: String): BySelector = By.res(id)

    private fun resourcePrefix(prefix: String): BySelector = By.res(
        Pattern.compile("^(?:${Pattern.quote(PACKAGE_NAME)}:id/)?${Pattern.quote(prefix)}.+$"),
    )

    private fun resourceNames(prefix: String): Set<String> =
        objects(resourcePrefix(prefix)).mapNotNull { it.resourceName }.toSet()

    private fun awaitNewResource(
        prefix: String,
        baseline: Set<String>,
        timeoutMs: Long,
        description: String,
    ): UiObject2 {
        val deadline = SystemClock.elapsedRealtime() + timeoutMs
        do {
            val current = objects(resourcePrefix(prefix))
            current.lastOrNull { it.resourceName !in baseline }?.let { return it }
            SystemClock.sleep(POLL_INTERVAL_MS)
        } while (SystemClock.elapsedRealtime() < deadline)
        error("Timed out waiting for $description")
    }

    private companion object {
        const val PACKAGE_NAME = "xyz.merchedits.snezhok"
        const val SAVED_MESSAGES_ID = "conversation_saved"
        const val E2E_PROTOCOL_ID = "messaging_e2e_v1"
        const val CHAT_TIMELINE_ID = "chat_timeline"
        const val CHAT_ATTACH_ID = "chat_attach"
        const val CHAT_COMPOSER_ID = "chat_composer"
        const val CHAT_SEND_ID = "chat_send"
        const val CHAT_VOICE_ID = "chat_voice"
        const val ATTACHMENT_SHEET_ID = "attachment_sheet"
        const val ATTACHMENT_SEND_ID = "attachment_send"
        const val MESSAGE_IMAGE_PREFIX = "message_image_"
        const val MESSAGE_VIDEO_PREFIX = "message_video_"
        const val MESSAGE_VOICE_PREFIX = "message_voice_"
        const val MESSAGE_COMMITTED_PREFIX = "message_committed_"
        const val CHATS_RU = "\u0427\u0430\u0442\u044b"
        const val CHATS_EN = "Chats"
        const val SAVED_MESSAGES_RU = "\u0421\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f"
        const val SAVED_MESSAGES_EN = "Saved Messages"
        const val CLOSE_PHOTO_RU = "\u0417\u0430\u043a\u0440\u044b\u0442\u044c \u0444\u043e\u0442\u043e"
        const val CLOSE_PHOTO_EN = "Close photo"
        const val CLOSE_VIDEO_RU = "\u0417\u0430\u043a\u0440\u044b\u0442\u044c \u0432\u0438\u0434\u0435\u043e"
        const val CLOSE_VIDEO_EN = "Close video"
        const val POLL_INTERVAL_MS = 100L
        const val SHORT_TIMEOUT_MS = 2_000L
        const val APP_START_TIMEOUT_MS = 15_000L
        const val INBOX_TIMEOUT_MS = 20_000L
        const val CHAT_OPEN_TIMEOUT_MS = 8_000L
        const val DRAWER_TIMEOUT_MS = 5_000L
        const val MEDIA_DISCOVERY_TIMEOUT_MS = 15_000L
        const val MESSAGE_TIMEOUT_MS = 20_000L
        const val UPLOAD_TIMEOUT_MS = 120_000L
        const val VIEWER_TIMEOUT_MS = 8_000L
        const val VOICE_HOLD_STEPS = 420
    }
}
