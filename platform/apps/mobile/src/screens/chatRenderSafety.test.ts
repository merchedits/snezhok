import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatSource = readFileSync(new URL("./ChatScreen.tsx", import.meta.url), "utf8");
const chatsSource = readFileSync(new URL("./ChatsScreen.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const serverAdminSource = readFileSync(new URL("../components/management/ServerAdminModal.tsx", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../store/useAppStore.ts", import.meta.url), "utf8");
const productivityDomainSource = readFileSync(new URL("../application/productivity/productivityDomain.ts", import.meta.url), "utf8");
const attachmentTransferDomainSource = readFileSync(new URL("../application/messaging/attachmentTransferDomain.ts", import.meta.url), "utf8");
const messageQueryDomainSource = readFileSync(new URL("../application/messaging/messageQueryActions.ts", import.meta.url), "utf8");
const activityMutationDomainSource = readFileSync(new URL("../application/activities/activityMutationActions.ts", import.meta.url), "utf8");
const timelineSource = readFileSync(new URL("../components/chat/ChatMessageList.tsx", import.meta.url), "utf8");
const composerSource = readFileSync(new URL("../components/chat/ChatComposer.tsx", import.meta.url), "utf8");
const updateProviderSource = readFileSync(new URL("../updates/UpdateProvider.tsx", import.meta.url), "utf8");
const messageBubbleSource = readFileSync(new URL("../components/MessageBubble.tsx", import.meta.url), "utf8");
const messageMediaSource = readFileSync(new URL("../components/message/MessageMedia.tsx", import.meta.url), "utf8");
const authenticatedImageSource = readFileSync(new URL("../components/AuthenticatedImage.tsx", import.meta.url), "utf8");
const voiceAttachmentSource = readFileSync(new URL("../components/VoiceMessageAttachment.tsx", import.meta.url), "utf8");
const bottomNavigationSource = readFileSync(new URL("../components/BottomNavigation.tsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("./SettingsScreen.tsx", import.meta.url), "utf8");
const attachmentSheetSource = readFileSync(new URL("../components/AttachmentSheet.tsx", import.meta.url), "utf8");
const attachmentControllerSource = readFileSync(new URL("../components/attachments/useAttachmentSheetController.ts", import.meta.url), "utf8");
const deviceMediaSource = readFileSync(new URL("../infrastructure/media/deviceMediaLibrary.ts", import.meta.url), "utf8");
const activityModalSource = readFileSync(new URL("../components/CooperativeActivityModal.tsx", import.meta.url), "utf8");
const activityInputsSource = readFileSync(new URL("../components/activities/CooperativeActivityInputs.tsx", import.meta.url), "utf8");
const activitySharedSource = readFileSync(new URL("../components/activities/CooperativeActivityShared.tsx", import.meta.url), "utf8");
const activityLauncherSource = readFileSync(new URL("../components/ActivityLauncherSheet.tsx", import.meta.url), "utf8");
const togetherHistorySource = readFileSync(new URL("../components/TogetherHistoryModal.tsx", import.meta.url), "utf8");
const newConversationSource = readFileSync(new URL("../components/NewConversationModal.tsx", import.meta.url), "utf8");
const messageSearchSource = readFileSync(new URL("../components/MessageSearchModal.tsx", import.meta.url), "utf8");
const managementUiSource = readFileSync(new URL("../components/management/ManagementUi.tsx", import.meta.url), "utf8");
const loginSource = readFileSync(new URL("./LoginScreen.tsx", import.meta.url), "utf8");
const profileSource = readFileSync(new URL("./ProfileScreen.tsx", import.meta.url), "utf8");

test("chat external-store selectors never allocate a filtered snapshot", () => {
  assert.doesNotMatch(chatSource, /useAppStore\(\(state\)\s*=>\s*state\.[^)]+\.filter\(/);
  assert.match(chatSource, /useMemo\([\s\S]{0,80}allScheduledMessages\.filter/);
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
  assert.match(messageMediaSource, /AuthenticatedImage/);
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
  assert.match(messageMediaSource, /message_image_\$\{attachment\.id\}/);
  assert.match(messageMediaSource, /message_video_\$\{attachment\.id\}/);
  assert.match(messageMediaSource, /message_voice_\$\{attachment\.id\}/);
  assert.match(deviceMediaSource, /AssetField\.MODIFICATION_TIME/);
  assert.doesNotMatch(deviceMediaSource, /orderBy\(\{ key: MediaLibrary\.AssetField\.CREATION_TIME/);
});

test("direct and channel message rows expose the same delivery-state selector", () => {
  assert.match(messageBubbleSource, /const stateTestId = `\$\{message\.failed \? "message_failed" : message\.pending \? "message_pending" : "message_committed"\}_\$\{message\.id\}`/);
  assert.equal(messageBubbleSource.match(/testID=\{stateTestId\}/g)?.length, 2);
});

test("fixed visual language removes configurable density, contrast, motion, and radii", () => {
  assert.doesNotMatch(settingsSource, /compactSpacing|highContrast|reduceMotion|messageCorners|bubbleRadiusOptions/);
  assert.doesNotMatch(bottomNavigationSource, /android_ripple|shadowOpacity|elevation/);
  assert.match(bottomNavigationSource, /Math\.max\(insets\.bottom, 12\) \+ 8/);
  assert.doesNotMatch(bottomNavigationSource, /<Text|styles\.label/);
  assert.match(bottomNavigationSource, /width: "68%", minWidth: 224, maxWidth: 252/);
});

test("productivity synchronization is single-flight and ignores duplicate online callbacks", () => {
  assert.match(productivityDomainSource, /if \(productivityRefresh\) return productivityRefresh/);
  assert.match(storeSource, /if \(get\(\)\.online === online\) return/);
});

test("audited native background transfers retain the resumable foreground fallback", () => {
  assert.match(storeSource, /available: backgroundTransferAvailable/);
  assert.match(attachmentTransferDomainSource, /if \(!background\.available\)/);
  assert.match(attachmentTransferDomainSource, /sendForegroundAttachmentBatch/);
});

test("cached chats use one bottom-anchor mechanism without a duplicate overlay", () => {
  assert.match(timelineSource, /const INITIAL_RENDERED_MESSAGES = 80/);
  assert.match(timelineSource, /startRenderingFromBottom: true/);
  assert.match(timelineSource, /onLoad=\{recordFirstPaint\}/);
  assert.doesNotMatch(timelineSource, /FIRST_FRAME_MESSAGES|firstFrameMessages|onContentSizeChange=/);
  assert.match(timelineSource, /onScrollBeginDrag=\{\(\) => \{[\s\S]{0,40}userDraggedHistory\.current = true/);
  assert.match(timelineSource, /initialBottomAnchored\.current = true;[\s\S]{0,160}scrollToEnd\(\{ animated: false \}\)/);
  assert.match(timelineSource, /targetMessageId \|\| userDraggedHistory\.current \|\| renderedMessages\.length === 0/);
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
  assert.match(messageQueryDomainSource, /const cachedMessagePreloads = new Map<string, Promise<void>>\(\)/);
  assert.match(messageQueryDomainSource, /cachedMessagePreloads\.get\(streamId\)/);
  assert.match(messageQueryDomainSource, /cachedMessagePreloads\.set\(streamId, preload\)/);
});

test("chat reconciliation waits for the native transition to settle", () => {
  assert.match(timelineSource, /navigation\.addListener\("transitionEnd"/);
  assert.match(timelineSource, /if \(routeSettled\) void refreshHistory\(\)/);
  assert.match(timelineSource, /preloadCachedMessages\(\[streamId\]\)/);
  assert.match(timelineSource, /recordPerformance\([\s\S]{0,80}chatOpenPerformanceKind\([\s\S]{0,80}cachedMessageCountAtOpen\.current/);
});

test("chat composer follows keyboard progress without late JS visibility jumps", () => {
  assert.match(composerSource, /useReanimatedKeyboardAnimation/);
  assert.match(composerSource, /interpolate\([\s\S]{0,40}keyboardProgress\.value/);
  assert.doesNotMatch(composerSource, /Keyboard\.addListener|keyboardDidShow|keyboardDidHide|keyboardVisible/);
});

test("chat identity header stays outside the keyboard-translated region", () => {
  const header = chatSource.indexOf("<ChatHeader");
  const keyboardRegion = chatSource.indexOf("<KeyboardAvoidingView", header);
  const timeline = chatSource.indexOf("<ChatMessageList", keyboardRegion);
  assert.ok(header >= 0 && keyboardRegion > header && timeline > keyboardRegion);
  assert.match(chatSource, /<KeyboardAvoidingView style=\{styles\.keyboardRegion\}/);
});

test("text-entry screens and management forms keep focused inputs above the keyboard", () => {
  assert.match(newConversationSource, /KeyboardAvoidingView[\s\S]*behavior="padding" automaticOffset/);
  assert.match(messageSearchSource, /KeyboardAvoidingView[\s\S]*behavior="padding" automaticOffset/);
  assert.match(managementUiSource, /KeyboardAwareScrollView bottomOffset=\{20\}/);
  assert.match(loginSource, /KeyboardAwareScrollView bottomOffset=\{20\}/);
  assert.match(profileSource, /KeyboardAwareScrollView bottomOffset=\{24\}/);
});

test("attachments expose camera capture without replacing original-file sending", () => {
  assert.match(attachmentControllerSource, /\.\.\.\(imagesOnly \? \[\] : \[UPLOAD_ITEM\]\),[\s\S]{0,30}CAMERA_ITEM/);
  assert.match(deviceMediaSource, /requestCameraPermissionsAsync/);
  assert.match(deviceMediaSource, /launchCameraAsync/);
  assert.match(deviceMediaSource, /stripLocation: true/);
  assert.doesNotMatch(attachmentSheetSource, /expo-(document-picker|image-picker|media-library)/);
});

test("cooperative drawing is live and color hunt resolves to generated collage media", () => {
  assert.match(activityModalSource, /subscribeRealtimeDrawing/);
  assert.match(activityModalSource, /emitRealtimeDrawing/);
  assert.match(activityInputsSource, /ownCollage[\s\S]{0,80}<CollagePhoto/);
  assert.match(activitySharedSource, /entry\.kind === "collage"/);
});

test("cooperative photo flows keep the prompt primary and use an overlapping seam-free collage", () => {
  assert.doesNotMatch(activityInputsSource, /Можно выбрать сразу все оставшиеся снимки|Ваши снимки откроются только после вклада обоих/);
  assert.doesNotMatch(activityModalSource, /Не сейчас|Отменить для обоих/);
  assert.match(activitySharedSource, /COLLAGE_TILES/);
  assert.match(activitySharedSource, /left: "33\.15%"/);
  assert.match(activitySharedSource, /pending = \[\]/);
  assert.match(activitySharedSource, /ActivityIndicator/);
  assert.match(activityModalSource, /processColorHuntBatch/);
  assert.match(activityModalSource, /attachmentIds: \[attachmentId\]/);
});

test("cooperative commands reconcile one stale peer revision without losing the action", () => {
  assert.match(activityMutationDomainSource, /error instanceof ApiError/);
  assert.match(activityMutationDomainSource, /await transport\.activity\(message\.activity\.id\)/);
  assert.match(activityMutationDomainSource, /transport\.commandActivity\(message\.activity\.id, expectedRevision, action, payload, clientId\)/);
  assert.match(activityMutationDomainSource, /const clientId = createId\(\)/);
  assert.match(activityMutationDomainSource, /if \(!retriedTransport && transportMayHaveCommitted\(error\)\)/);
});

test("Together history projects durable activity messages without local duplicate storage", () => {
  assert.match(activityLauncherSource, /onOpenHistory/);
  assert.match(togetherHistorySource, /activityQueries\.history\(conversationId\)/);
  assert.match(togetherHistorySource, /CooperativeActivityCard/);
  assert.doesNotMatch(togetherHistorySource, /AsyncStorage|SQLite|insert|persist/i);
});
