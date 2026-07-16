import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const chatSource = readFileSync(new URL("./ChatScreen.tsx", import.meta.url), "utf8");
const chatsSource = readFileSync(new URL("./ChatsScreen.tsx", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../store/useAppStore.ts", import.meta.url), "utf8");

test("chat external-store selectors never allocate a filtered snapshot", () => {
  assert.doesNotMatch(chatSource, /useAppStore\(\(state\)\s*=>\s*state\.[^)]+\.filter\(/);
  assert.match(chatSource, /useMemo\(\(\)\s*=>\s*allScheduledMessages\.filter/);
});

test("chat folder filters stay a compact horizontal strip", () => {
  assert.match(chatsSource, /style=\{styles\.filterStrip\}/);
  assert.match(chatsSource, /filterStrip:\s*\{[^}]*flexGrow:\s*0[^}]*height:\s*41/);
});

test("productivity synchronization is single-flight and ignores duplicate online callbacks", () => {
  assert.match(storeSource, /if \(productivityRefresh\) return productivityRefresh/);
  assert.match(storeSource, /if \(get\(\)\.online === online\) return/);
});

test("cached chat rows paint before FlashList's deferred layout pass", () => {
  assert.match(chatSource, /const INITIAL_RENDERED_MESSAGES = 80/);
  assert.match(chatSource, /renderedMessages\.slice\(-FIRST_FRAME_MESSAGES\)/);
  assert.match(chatSource, /!listReady && firstFrameMessages\.length/);
  assert.match(chatSource, /onScrollBeginDrag=\{\(\) => \{ userDraggedHistory\.current = true/);
});

test("conversation taps never mount a native chat route before onPress", () => {
  assert.doesNotMatch(chatsSource, /navigation\.preload/);
  assert.doesNotMatch(chatsSource, /onPressIn=/);
  assert.doesNotMatch(chatsSource, /refresh\(\{ silent: true \}\)/);
  assert.match(chatsSource, /chatParams\(conversation, performance\.now\(\)\)/);
  assert.match(chatsSource, /active && screenFocused/);
});

test("chat reconciliation waits for the native transition to settle", () => {
  assert.match(chatSource, /navigation\.addListener\("transitionEnd"/);
  assert.match(chatSource, /if \(!routeSettled\) return/);
  assert.match(chatSource, /recordPerformance\(cachedMessageCountAtOpen\.current > 0/);
});
