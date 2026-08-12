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
const attachmentSheetSource = readFileSync(new URL("../components/AttachmentSheet.tsx", import.meta.url), "utf8");
const activityModalSource = readFileSync(new URL("../components/CooperativeActivityModal.tsx", import.meta.url), "utf8");
const activityLauncherSource = readFileSync(new URL("../components/ActivityLauncherSheet.tsx", import.meta.url), "utf8");
const togetherHistorySource = readFileSync(new URL("../components/TogetherHistoryModal.tsx", import.meta.url), "utf8");
const newConversationSource = readFileSync(new URL("../components/NewConversationModal.tsx", import.meta.url), "utf8");
const messageSearchSource = readFileSync(new URL("../components/MessageSearchModal.tsx", import.meta.url), "utf8");
const managementUiSource = readFileSync(new URL("../components/management/ManagementUi.tsx", import.meta.url), "utf8");
const loginSource = readFileSync(new URL("./LoginScreen.tsx", import.meta.url), "utf8");
const profileSource = readFileSync(new URL("./ProfileScreen.tsx", import.meta.url), "utf8");

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
  assert.match(authenticatedImageSource, /recyclingKey=\{`\$\{cacheKey\}:\$\{usingFallback/);
  assert.doesNotMatch(voiceAttachmentSource, /react-native-svg|<Svg|<Path/);
  assert.match(voiceAttachmentSource, /styles\.waveformBar/);
  assert.match(voiceAttachmentSource, /useAuthorizedMedia/);
  assert.match(voiceAttachmentSource, /useAudioPlayer\(source/);
  assert.match(voiceAttachmentSource, /key=\{attempt\}/);
  assert.match(voiceAttachmentSource, /if \(status\.error \|\| playbackFailed\) \{\s+onRetry\(\)/);
  assert.doesNotMatch(voiceAttachmentSource, /useCachedAuthorizedMedia|File\.createDownloadTask/);
  assert.match(voiceAttachmentSource, /idleWaveform = mine \? "rgba\(255,255,255,0\.72\)"/);
});

test("fixed visual language removes configurable density, contrast, motion, and radii", () => {
  assert.doesNotMatch(settingsSource, /compactSpacing|highContrast|reduceMotion|messageCorners|bubbleRadiusOptions/);
  assert.doesNotMatch(bottomNavigationSource, /android_ripple|shadowOpacity|elevation/);
  assert.match(bottomNavigationSource, /Math\.max\(insets\.bottom, 12\) \+ 8/);
  assert.doesNotMatch(bottomNavigationSource, /<Text|styles\.label/);
  assert.match(bottomNavigationSource, /width: "68%", minWidth: 224, maxWidth: 252/);
});

test("productivity synchronization is single-flight and ignores duplicate online callbacks", () => {
  assert.match(storeSource, /if \(productivityRefresh\) return productivityRefresh/);
  assert.match(storeSource, /if \(get\(\)\.online === online\) return/);
});

test("audited native background transfers retain the resumable foreground fallback", () => {
  assert.match(storeSource, /const DURABLE_BACKGROUND_TRANSFERS_ENABLED = true/);
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
  assert.match(chatsSource, /InteractionManager\.runAfterInteractions/);
  assert.match(chatsSource, /length: rowHeight \+ 2, offset: \(rowHeight \+ 2\) \* index/);
});

test("cached message warmups are single-flight per stream", () => {
  assert.match(storeSource, /const cachedMessagePreloads = new Map<string, Promise<void>>\(\)/);
  assert.match(storeSource, /cachedMessagePreloads\.get\(streamId\)/);
  assert.match(storeSource, /cachedMessagePreloads\.set\(streamId, preload\)/);
});

test("chat reconciliation waits for the native transition to settle", () => {
  assert.match(chatSource, /navigation\.addListener\("transitionEnd"/);
  assert.match(chatSource, /if \(!routeSettled\) return/);
  assert.match(chatSource, /preloadCachedMessages\(\[streamId\]\)/);
  assert.match(chatSource, /recordPerformance\(chatOpenPerformanceKind\(cachedMessageCountAtOpen\.current\)/);
});

test("chat composer follows keyboard progress without late JS visibility jumps", () => {
  assert.match(chatSource, /useReanimatedKeyboardAnimation/);
  assert.match(chatSource, /interpolate\(keyboardProgress\.value/);
  assert.doesNotMatch(chatSource, /Keyboard\.addListener|keyboardDidShow|keyboardDidHide|keyboardVisible/);
});

test("text-entry screens and management forms keep focused inputs above the keyboard", () => {
  assert.match(newConversationSource, /KeyboardAvoidingView[\s\S]*behavior="padding" automaticOffset/);
  assert.match(messageSearchSource, /KeyboardAvoidingView[\s\S]*behavior="padding" automaticOffset/);
  assert.match(managementUiSource, /KeyboardAwareScrollView bottomOffset=\{20\}/);
  assert.match(loginSource, /KeyboardAwareScrollView bottomOffset=\{20\}/);
  assert.match(profileSource, /KeyboardAwareScrollView bottomOffset=\{24\}/);
});

test("attachments expose camera capture without replacing original-file sending", () => {
  assert.match(attachmentSheetSource, /\.\.\.\(imagesOnly \? \[\] : \[UPLOAD_ITEM\]\), CAMERA_ITEM,/);
  assert.match(attachmentSheetSource, /requestCameraPermissionsAsync/);
  assert.match(attachmentSheetSource, /launchCameraAsync/);
  assert.match(attachmentSheetSource, /stripLocation: true/);
});

test("cooperative drawing is live and color hunt resolves to generated collage media", () => {
  assert.match(activityModalSource, /subscribeRealtimeDrawing/);
  assert.match(activityModalSource, /emitRealtimeDrawing/);
  assert.match(activityModalSource, /ownCollage \? <CollagePhoto/);
  assert.match(activityModalSource, /entry\.kind === "collage"/);
});

test("cooperative commands reconcile one stale peer revision without losing the action", () => {
  assert.match(storeSource, /error instanceof ApiError/);
  assert.match(storeSource, /await api\.activity\(message\.activity\.id\)/);
  assert.match(storeSource, /api\.commandActivity\(message\.activity\.id, expectedRevision, action, payload, clientId\)/);
  assert.match(storeSource, /const clientId = Crypto\.randomUUID\(\)/);
  assert.match(storeSource, /if \(!retriedTransport && activityTransportMayHaveCommitted\(error\)\)/);
});

test("Together history projects durable activity messages without local duplicate storage", () => {
  assert.match(activityLauncherSource, /onOpenHistory/);
  assert.match(togetherHistorySource, /api\.activityHistory\(conversationId\)/);
  assert.match(togetherHistorySource, /CooperativeActivityCard/);
  assert.doesNotMatch(togetherHistorySource, /AsyncStorage|SQLite|insert|persist/i);
});
