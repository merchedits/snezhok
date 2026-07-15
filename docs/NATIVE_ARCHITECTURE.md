# Native architecture

Snezhok retains Telegram's proven Android presentation and media machinery while
replacing the Telegram protocol, persistence and account model behind explicit
Snezhok boundaries.

```text
Telegram-derived views and animation state machines
                    |
Snezhok presentation models and typed UI commands
                    |
Repositories / use cases / durable outbox
                    |
Snezhok SQLite projections and transfer queue
                    |
REST, Socket.IO, authenticated media and audited call transport
```

## Retained presentation systems

- `ChatAttachAlert` and its gallery/document layouts.
- `ChatActivityEnterView` recording gestures and animations.
- `InstantCameraView` video-note capture and presentation.
- Opus recording and waveform JNI routines in `jni/audio.c`.
- `SeekBarWaveform` rendering and interaction.
- `PhotoViewer` zoom, pan, transitions and media controls.
- `ChatActivity` selection/action-mode presentation.
- Telegram reaction picker, bubble rendering and optimistic animation.
- Telegram video transcoding primitives.

## Forbidden transport shortcuts

Snezhok repositories must not persist or transmit `TLRPC` objects and must not
use `ConnectionsManager`, `SendMessagesHelper`, `MessagesStorage` or Telegram's
`FileLoader` as Snezhok protocol abstractions. Those classes encode MTProto IDs,
requests, reconciliation and storage semantics that do not match the Snezhok API.

A temporary presentation bridge may translate a Snezhok model for an isolated
view during migration, but no server, database, outbox or business rule may
depend on that bridge.

## First vertical slice

1. Secure, update-stable login/register/refresh session.
2. Cached `/bootstrap` inbox projection.
3. Cursor-paged direct-message history and idempotent text outbox.
4. Socket resume, stream join/leave and message/read/presence events.
5. Authenticated attachment upload/download with progress.
6. Retained Telegram interaction surfaces wired to Snezhok commands.

`SnezhokCore` now implements the first transport and session foundation without
adding another HTTP/JSON dependency. `SnezhokPreviewApp` gives it an isolated
debug-only application identity while the retained UI is migrated.
