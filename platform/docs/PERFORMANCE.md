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
  failed messages. Older history remains authoritative on the server and is
  fetched by cursor.
- Deduplicate concurrent history requests and consider a freshly loaded stream
  valid for 15 seconds. Start the request on chat-row press-in so the gesture and
  network latency overlap.
- Keep list rows fixed-height, memoized, and backed by `getItemLayout`. Keep
  `FlatList` windows deliberately small on Android.
- Images use the native Glide-backed `expo-image` memory/disk cache. Do not
  prefetch the entire inbox; load visible assets and the selected destination.
- Audio and video players are created only after the user presses play. A chat
  containing many media messages must not instantiate one native decoder per
  visible attachment.
- Animations should use transforms and opacity on the UI thread. Network or
  storage work starts after the navigation animation, never inside it.

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

1. Add an Android Macrobenchmark/baseline-profile companion project and record
   cold start, inbox-to-chat, and a 200-message scroll on the target device.
2. Replace the JSON message cache with a paged SQLite store once typical accounts
   exceed the bounded cache or need reliable full-history offline search.
3. Batch the API bootstrap conversation-summary queries; the current server
   implementation is acceptable for a few users but performs repeated queries
   per conversation and will not scale linearly.
4. Add generated media thumbnails and dimensions to every attachment so list
   layout never waits for a full-resolution decode.
5. Profile JS and UI frame time in release builds before changing transition
   durations. A shorter dropped-frame animation is still a dropped-frame
   animation.

## Anti-patterns

- Do not preload every chat, avatar, or attachment at startup.
- Do not serialize full message history after every socket event.
- Do not mount media decoders merely to render a thumbnail.
- Do not use `notifyDataSetChanged`-style whole-list invalidation when one row
  changed.
- Do not raise cache sizes as a substitute for cursor pagination.
