import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatSource = readFileSync(new URL("./ChatScreen.tsx", import.meta.url), "utf8");
const chatsSource = readFileSync(new URL("./ChatsScreen.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const serverAdminSource = readFileSync(new URL("../components/management/ServerAdminModal.tsx", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../store/useAppStore.ts", import.meta.url), "utf8");
const updateProviderSource = readFileSync(new URL("../updates/UpdateProvider.tsx", import.meta.url), "utf8");
const messageBubbleSource = readFileSync(new URL("../components/MessageBubble.tsx", import.meta.url), "utf8");
const authenticatedImageSource = readFileSync(new URL("../components/AuthenticatedImage.tsx", import.meta.url), "utf8");
const voiceAttachmentSource = readFileSync(new URL("../components/VoiceMessageAttachment.tsx", import.meta.url), "utf8");
const bottomNavigationSource = readFileSync(new URL("../components/BottomNavigation.tsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("./SettingsScreen.tsx", import.meta.url), "utf8");

test("chat external-store selectors never allocate a filtered snapshot", () => {
  assert.doesNotMatch(chatSource, /useAppStore\(\(state\)\s*=>\s*state\.[^)]+\.filter\(/);
  assert.match(chatSource, /useMemo\(\(\)\s*=>\s*allScheduledMessages\.filter/);
});

test("startup-warmed server administration keeps external-store snapshots stable", () => {
  assert.doesNotMatch(serverAdminSource, /useAppStore\(\(state\)\s*=>\s*state\.[^)]+\.filter\(/);
  assert.match(serverAdminSource, /const allCategories = useAppStore\(\(state\) => state\.categories\)/);
  assert.match(serverAdminSource, /useMemo\(\(\) => allCategories\.filter/);
  assert.match(serverAdminSource, /const allChannels = useAppStore\(\(state\) => state\.channels\)/);
  assert.match(serverAdminSource, /useMemo\(\(\) => allChannels\.filter/);
});

test("launch-time storage failures are contained instead of becoming unhandled rejections", () => {
  assert.match(appSource, /void initialize\(\)\.catch\(/);
  assert.match(appSource, /useAppStore\.setState\(\{ phase: "error", error: null \}\)/);
  assert.match(updateProviderSource, /AsyncStorage\.getItem\(AUTO_UPDATE_KEY\)[\s\S]*?\.catch\(/);
});

test("small-deployment chats hide global search, folders, and archive controls", () => {
  assert.doesNotMatch(chatsSource, /styles\.filterStrip|MessageSearchModal|TextEntryModal/);
  assert.doesNotMatch(chatsSource, /onArchive=|onAddToFolder=|onToggleFolder=/);
});

test("chat media uses native bounded caches and lazy audio players", () => {
  assert.match(messageBubbleSource, /AuthenticatedImage/);
  assert.match(authenticatedImageSource, /from "expo-image"/);
  assert.match(authenticatedImageSource, /useAuthorizedMedia/);
  assert.match(authenticatedImageSource, /cachePolicy="memory-disk"/);
  assert.match(authenticatedImageSource, /recyclingKey={cacheKey}/);
  assert.doesNotMatch(voiceAttachmentSource, /react-native-svg|<Svg|<Path/);
  assert.match(voiceAttachmentSource, /styles\.waveformBar/);
  assert.match(voiceAttachmentSource, /useAuthorizedMedia/);
  assert.match(voiceAttachmentSource, /useAudioPlayer\(source/);
  assert.match(voiceAttachmentSource, /key=\{attempt\}/);
  assert.match(voiceAttachmentSource, /if \(status\.error\) \{\s+onRetry\(\)/);
  assert.doesNotMatch(voiceAttachmentSource, /useCachedAuthorizedMedia|File\.createDownloadTask/);
  assert.match(voiceAttachmentSource, /idleWaveform = mine \? "rgba\(255,255,255,0\.72\)"/);
});

test("fixed visual language removes configurable density, contrast, motion, and radii", () => {
  assert.doesNotMatch(settingsSource, /compactSpacing|highContrast|reduceMotion|messageCorners|bubbleRadiusOptions/);
  assert.doesNotMatch(bottomNavigationSource, /android_ripple|shadowOpacity|elevation/);
  assert.match(bottomNavigationSource, /Math\.max\(insets\.bottom, 16\)/);
});

test("productivity synchronization is single-flight and ignores duplicate online callbacks", () => {
  assert.match(storeSource, /if \(productivityRefresh\) return productivityRefresh/);
  assert.match(storeSource, /if \(get\(\)\.online === online\) return/);
});

test("private stabilization builds use the resumable foreground attachment path", () => {
  assert.match(storeSource, /const DURABLE_BACKGROUND_TRANSFERS_ENABLED = false/);
  assert.match(storeSource, /!DURABLE_BACKGROUND_TRANSFERS_ENABLED \|\| !backgroundTransferAvailable/);
});

test("cached chats use one bottom-anchor mechanism without a duplicate overlay", () => {
  assert.match(chatSource, /const INITIAL_RENDERED_MESSAGES = 80/);
  assert.match(chatSource, /startRenderingFromBottom: true/);
  assert.match(chatSource, /onLoad=\{recordFirstPaint\}/);
  assert.doesNotMatch(chatSource, /FIRST_FRAME_MESSAGES|firstFrameMessages|onContentSizeChange=/);
  assert.match(chatSource, /onScrollBeginDrag=\{\(\) => \{ userDraggedHistory\.current = true/);
});

test("conversation touch warms SQLite without pre-mounting the native route", () => {
  assert.doesNotMatch(chatsSource, /navigation\.preload/);
  assert.match(chatsSource, /onPressIn=\{\(\) => onWarm\(conversation\)\}/);
  assert.match(chatsSource, /preloadCachedMessages\(\[conversation\.id\]\)/);
  assert.doesNotMatch(chatsSource, /refresh\(\{ silent: true \}\)/);
  assert.match(chatsSource, /chatParams\(conversation, performance\.now\(\)\)/);
  assert.match(chatsSource, /active && screenFocused/);
});

test("cached message warmups are single-flight per stream", () => {
  assert.match(storeSource, /const cachedMessagePreloads = new Map<string, Promise<void>>\(\)/);
  assert.match(storeSource, /cachedMessagePreloads\.get\(streamId\)/);
  assert.match(storeSource, /cachedMessagePreloads\.set\(streamId, preload\)/);
});

test("chat reconciliation waits for the native transition to settle", () => {
  assert.match(chatSource, /navigation\.addListener\("transitionEnd"/);
  assert.match(chatSource, /if \(!routeSettled\) return/);
  assert.match(chatSource, /recordPerformance\(cachedMessageCountAtOpen\.current > 0/);
});
