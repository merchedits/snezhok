# Performance strategy

Snezhok targets inexpensive Android devices first. The performance budget is a
Samsung Galaxy A12-class phone: four slow cores, constrained memory, 60 Hz, and
an unreliable mobile connection. Optimizations must improve measured startup,
navigation, scrolling, or battery use; speculative preloading is not a goal.

## Current client rules

- Render cached data immediately, then reconcile with the server in the
  background. Never put a full bootstrap request on the critical path of a tab
  transition.
- Coalesce realtime cache writes. Presence changes are ephemeral and are not
  written to disk.
- Persist only the latest 80 messages per stream, plus pinned, pending, and
  failed messages, in the WAL-backed SQLite offline store. The store exposes
  sequence-cursor pages and migrates the former AsyncStorage v2 snapshot in one
  transaction. Older history remains authoritative on the server.
- Deduplicate concurrent history requests and consider a freshly loaded stream
  valid for 15 seconds. Start the SQLite read on chat-row press-in so storage
  latency overlaps the gesture. A chat route opened from a notification or deep
  link starts the same cache-only warmup immediately; server and pinned-message
  reconciliation still waits for the native transition to finish.
- Keep list rows fixed-height, memoized, and backed by `getItemLayout`. Keep
  `FlatList` windows deliberately small on Android.
- Images use the native Glide-backed `expo-image` memory/disk cache. Do not
  prefetch the entire inbox; load visible assets and the selected destination.
- Normal Android photo sends use Snezhok's sampled native JPEG compressor before
  upload. It decodes near the requested long edge instead of materializing the
  complete camera bitmap, preserves EXIF orientation, strips metadata, and
  falls back to Expo image manipulation if the native module is unavailable.
  Keep multi-photo preparation bounded on low-memory devices.
- Image and video attachments carry server-derived dimensions and a compact
  thumbnail variant. Reserve layout from dimensions and decode the thumbnail in
  message cells; the full-resolution object is for the viewer only.
- Audio and video players are created only after the user presses play. A chat
  containing many media messages must not instantiate one native decoder per
  visible attachment.
- Animations should use transforms and opacity on the UI thread. Network work
  starts after the navigation animation. The only storage work allowed during a
  chat transition is the bounded, deduplicated SQLite first-page warmup needed
  to paint a cold cached route.
- The chat composer follows the keyboard controller's UI-thread progress. Do
  not switch safe-area padding from `keyboardDidShow`/`keyboardDidHide`; those
  callbacks arrive at the animation boundary and cause a visible final-frame
  jump on Samsung firmware.
- Bootstrap conversation summaries use three recipient-scoped batch queries
  for membership/state, participants, and visible previews plus unread counts.
  Query count must remain constant as the inbox grows; do not reintroduce
  per-conversation participant or last-message lookups.

## Reference clients

The implementation is informed by, but does not copy code from, these projects:

- [Telegram Android](https://github.com/DrKLO/Telegram) uses a deeply customized
  native Android UI and native media/networking code. Its lesson for Snezhok is
  strict control over hot rendering paths and avoiding generic component work in
  message cells.
- [Signal Android](https://github.com/signalapp/Signal-Android) keeps dedicated
  benchmark and baseline-profile modules next to a modular application. Snezhok
  should add reproducible cold-start and chat-scroll benchmarks before further
  animation tuning.
- [Element X Android](https://github.com/element-hq/element-x-android) is a clean
  rewrite on a shared Matrix Rust SDK, with the UI separated from durable sync
  state. Snezhok follows the same separation at a smaller scale: server state is
  authoritative, while the UI consumes a bounded local projection and a sync
  cursor.
- [SimpleX Chat](https://github.com/simplex-chat/simplex-chat) treats the local
  database and file transfer as first-class subsystems, including encrypted
  local files and efficient large-file transfer. These are security and storage
  goals for Snezhok, not features to bolt onto the rendering layer.

## Next measurements

1. Record the checked-in Android Macrobenchmark suite on the target device. It
   covers cold start with and without a Baseline Profile, inbox-to-chat frame
   time, an in-memory warm chat reopen, composer keyboard motion, and a repeated
   long-chat scroll. Generate the production profile from
   an authenticated physical-device run; never fabricate one in CI without the
   real app path.
2. Measure SQLite page-read and write-amplification costs on a large synthetic
   inbox before considering a larger offline projection or full-history search.
3. Measure thumbnail cache hit rate and decoded-memory pressure on media-heavy
   chats before changing thumbnail dimensions or cache policy.
4. Profile JS and UI frame time in release builds before changing transition
   durations. A shorter dropped-frame animation is still a dropped-frame
   animation.

## Android benchmark workflow

The mobile config plugin creates an isolated `:macrobenchmark` module during
Expo prebuild, marks the release app profileable, and installs AndroidX
ProfileInstaller for sideloaded APKs. The benchmark dependency is not linked
into the application.

1. Connect the physical SM-A125F, keep animations enabled, and sign the release
   app into a private test account. Seed Saved Messages with enough rows to
   scroll.
2. Prebuild Android, commit the exact candidate, and from `platform/` run
   `npm run release:verify-android-physical`.
3. The runner executes the Macrobenchmark journeys using stable resource IDs,
   validates the numerical budgets, rejects emulator evidence, and copies JSON
   plus Perfetto traces into the revision-bound `runtime/evidence/android`
   directory.
4. Copy the generated `*-baseline-prof.txt` from that evidence into
   `apps/mobile/performance/baseline-prof.txt`, prebuild again, and compare the
   profiled and unprofiled cold-start results before publishing.

`performance/baseline-prof.txt` is intentionally absent until a physical-device
run produces it. ProfileInstaller improves first-run compilation for direct APK
installs once that measured profile is present.

## Anti-patterns

- Do not preload every chat, avatar, or attachment at startup.
- Do not serialize full message history after every socket event.
- Do not mount media decoders merely to render a thumbnail.
- Do not decode full-resolution camera photos merely to produce normal-quality
  uploads. HQ and original-file sends are the explicit exceptions.
- Do not use `notifyDataSetChanged`-style whole-list invalidation when one row
  changed.
- Do not raise cache sizes as a substitute for cursor pagination.
