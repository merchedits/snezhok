# Snezhok Product Specification

## Purpose

Snezhok is a private communication and cooperative-experience application for a small group of friends. Accounts use ordinary email, username, and password registration. It combines:

- Telegram-style direct and group messaging: immediate, compact, media-capable, and easy to understand.
- Reliable voice/video calls and screen sharing.
- Small shared activities where both people contribute and the result remains in their conversation.

The product has first-party web and Android clients. Android is the primary product reference and is distributed as a signed APK rather than through a public app store. It defaults to Russian and offers English in Settings. Both clients use the same account, content, permissions, settings, and realtime state.

Discord-style servers, text channels, voice channels, and their administration remain implemented as a dormant capability. They are not part of the current user-facing product and must not appear in client navigation, search, notifications, deep links, settings, or administration until explicitly reactivated.

This is a clean-slate product. Existing data can be migrated, but existing UI code, styling, client state, special-case conversation logic, and peer-mesh call implementation are not design constraints.

## Product principles

1. Familiar foundations, purposeful novelty. Messaging and calls follow proven patterns; cooperative activities may be new but must begin and end naturally in chat.
2. Content before chrome. Messages, files, participants, and call state receive the available space.
3. Fast by default. Cached content appears immediately and synchronizes in the background.
4. Quiet until needed. Secondary metadata and advanced controls stay behind conventional menus or drawers.
5. One action, one obvious location. Common actions must not be duplicated across decorative panels.
6. Private by default. Accounts are public to register but content is visible only to authorized participants; location metadata is stripped from compressed media.
7. Reliable under degraded conditions. Sending, uploads, calls, and reconnects expose honest states and recover without losing user work.
8. Shared, not addictive. Activities reward contribution and preserve memories without streak pressure, compatibility grading, leaderboards, or engagement manipulation.

## Product vocabulary

Use familiar labels consistently:

- **Chats**: direct messages and private group chats.
- **Friends**: mutually accepted contacts.
- **Call**: a direct or private-group voice/video session.
- **Activity**: a shared object started in a conversation that asks its participants to contribute.
- **Result**: the durable completed form of an activity, retained in chat/history.
- **Servers**, **text channels**, and **voice channels**: dormant implemented concepts reserved for possible future reactivation.

Do not rename these concepts to hubs, lounges, circles, spaces, moments, or other invented terms.

## Primary navigation

### Desktop web

Web remains secondary and follows the Android product model after mobile behavior stabilizes. Its current shell exposes Chats, Profile, and Settings with a conversation content pane and an optional information drawer. Dormant server rails and channel navigation are not user-facing.

### Android

The default surface is the current conversation or the Chats list. Three stable bottom destinations are **Chats**, **Profile**, and **Settings**. They use one consistent Tabler-style icon family, respect Android navigation insets, and switch directly to the destination with a single short directional transition; intermediate tabs are never rendered as a visible carousel. A compose floating action button appears only on the Chats list.

System Back resolves the nearest transient state first:

1. Close a menu, viewer, or dialog.
2. Cancel message selection or composer reply/edit mode.
3. Close any contextual sheet or cooperative-activity panel.
4. Return to the previous list or root tab.
5. Leave the application only when already at its root.

The conversation composer stays above the software keyboard and respects gesture navigation insets. The app supports portrait and landscape layouts.

## Accounts and onboarding

The login screen contains the snowflake product mark and name, username, password, Sign in, and a route to registration. Registration contains email, username, password, and confirmation. Errors appear next to the relevant field or as a concise form error.

There is no public marketing landing page, feature carousel, testimonial section, or decorative onboarding sequence.

An account includes:

- Stable user ID.
- Unique username.
- Display name.
- Avatar.
- Biography.
- Custom status.
- Presence and last-seen state according to privacy settings.
- Administrative status where applicable.

Sessions are visible in Settings. Users can revoke individual sessions or all other sessions.

## Chats

### Chat list

Rows show a 52 px avatar, name, one-line message preview, timestamp, mute state, and numeric unread badge. Pinned chats appear first, followed by remaining chats in reverse activity order. Rows are not cards.

The Chats sidebar or screen exposes:

- Search.
- Friends.
- Requests with a pending count.
- Direct messages and private groups.
- New chat.

New chat opens a conventional action sheet or menu with New message and New group. New group follows contact selection, group name and avatar, then creation.

Desktop context menus and Android long press expose Pin, Mute, Mark read or unread, Archive, and Leave or Delete when applicable. Android may offer configurable swipe actions; the default is swipe right for read state and swipe left for archive.

### Friends

Friends uses All, Online, and Requests tabs. Each person occupies one compact row with Message and overflow actions. Add friend is a single username field with an explicit result.

Requests distinguish incoming and outgoing state. Incoming requests offer Accept and Decline. Outgoing requests offer Cancel. Removing a friend requires confirmation but does not automatically delete message history.

## Cooperative experiences

The direct-chat header will expose one prominent ✦ action after the shared activity framework and at least one complete activity are available. It opens a compact roulette for asking, quests, play, picking, or surprise rather than presenting a permanent games tab.

Every activity follows one product equation:

`one tap → shared state → both contribute → durable result in chat/history`

Question Drop with open and secret answers is the foundation release. Blitz, Tiny Quest, Ideas Jar, Movie List, Song Exchange, Draw & Guess, Color Hunt, Memory Capsule, and cooperative milestones build on the same lifecycle and card grammar. Requirements, consent rules, provider constraints, delivery order, and acceptance tests are authoritative in `COOPERATIVE_EXPERIENCES.md`.

## Servers (dormant)

Server code, API routes, data, permissions, and administration are preserved for future use, but no current client exposes them. The checked-in Android capability switch is the single product gate. Reactivation requires a dedicated product decision, current security/reliability audit, refreshed documentation, regression tests, and a signed release.

The following describes the retained future model and is not current navigation behavior.

Desktop may use a compact server rail. Android may use a dedicated destination with a horizontal server picker. Unread servers and mentions use compact badges.

The server header menu contains Notifications, Server settings for authorized members, and Leave server.

Servers contain ordered categories. Categories collapse and remember local state. Text channels use a number-sign icon; voice channels use a speaker icon. Unread channel names receive stronger contrast, while the selected channel uses one quiet filled row.

A text channel header displays its topic only when it is non-empty. Pinned messages, search, and member list are header actions rather than persistent panels.

A voice channel expands inline to show connected members, speaking state, mute state, camera state, and screen-sharing state. Selecting a voice channel previews its participants. Joining is an explicit action.

The server domain model includes:

- Servers and server ownership.
- Server memberships.
- Categories.
- Text channels and voice channels.
- Roles.
- Server-level permissions.
- Channel permission overrides.
- Channel read markers, mute state, and notification overrides.

The permission system must support at minimum View channel, Send messages, Attach files, Add reactions, Manage messages, Connect, Speak, Video, Screen share, Move members, Manage channels, Manage roles, Kick members, and Ban members.

## Messaging

### Presentation

Direct messages and private groups use Telegram-style message bubbles. Messages from the current user are right-aligned with a restrained accent tint. Other messages are left-aligned with a neutral surface. Sender names appear in multi-person groups.

Server text channels use Discord-style author-led rows without bubbles. A 40 px avatar and author line appear on the first message in a group. Consecutive messages from the same author within five minutes are compactly grouped. Desktop hover and Android long press reveal the timestamp for grouped follow-ups.

Both modes use quiet date separators, a New messages divider, and a compact typing line. None are floating cards.

### Composer

The composer contains attachment, expanding text input, and emoji controls. A send action appears only when text or media is ready. Enter sends on desktop and Shift+Enter creates a line break. Android keyboard-send behavior is configurable.

Reply mode shows one compact source preview above the composer. Sent replies contain a compact reference above the message content. Selecting the reference navigates to the source and briefly highlights it.

Editing occurs inline. The edited marker is subtle. Drafts are retained locally per chat or channel.

### Message state

Messages send optimistically and expose terse visual state:

- Clock: pending locally.
- Single check: accepted by the server.
- Retry icon: failed and retained locally.

Verbose delivery labels are not shown beside every message. Reconnect reconciliation must not duplicate optimistic messages.

### Message actions

On Android, tapping a message opens the compact reaction picker, double-tapping applies a heart, and swiping the message left starts a reply. A photo or video reserves narrow edge targets for the reaction picker so the center remains an unambiguous viewer action. Long press enters Telegram-style multi-message selection: text selection is disabled, circular checkmarks animate into the left gutter, selected bubbles receive a restrained highlight, and the toolbar uses one-word labels **Copy**, **Forward**, **Pin**, and **Delete**. Once selection is active, one tap toggles every message kind, including media and cooperative-activity cards; System Back clears the selection before navigating. Multi-message mutations project as one immediate local change and reconcile with the server as a batch, restoring only permanently failed items. Actions that cannot apply to the complete selection are disabled or omitted. Desktop exposes the equivalent actions through hover and context menus.

Deletion asks for confirmation when it affects other users. Pinning can optionally notify members. Pinned-message lists are chronological and jump to the original message.

### Emoji and reactions

The emoji picker contains Search, Recent, People, Nature, Food, Activity, Travel, Objects, Symbols, and Flags. Category assets load lazily. The selected skin tone is retained across sessions.

Reactions render as compact emoji chips without numeric counts. On text messages they share the metadata baseline with the timestamp; on photo/video-only messages they occupy a translucent bottom-left overlay opposite the timestamp and delivery state. They must not create a third stacked row or inflate the bubble. The current user's selection remains visually explicit. Repeated reactions update optimistically and reconcile with the server.

### Search

Conversation search supports sender, date range, media type, and chat filters. Selecting a result opens the exact message in surrounding context. Global search, folders, and archive controls are currently hidden from the Chats screen for the small private deployment; their implementation remains dormant.

## Voice notes and video notes

Voice and video notes follow Telegram's established gesture model.

For voice notes:

- Hold the microphone to record.
- Slide left to cancel.
- Slide up to lock recording.
- Release to send when not locked.
- Locked mode exposes Stop, Delete, and Send.
- A timer and live waveform remain visible while recording.

Tapping the microphone toggles the composer control to a round-video-note camera. Video-note recording uses the same hold, cancel, and lock gestures. Completion provides Preview, Retake, and Send.

A voice-note message contains play or pause, waveform scrubbing, elapsed and total duration, and playback speed at 1x, 1.5x, or 2x. Optional continuous playback can continue while navigating.

Round video notes autoplay muted only while substantially visible. Selecting one expands it. The original asset remains downloadable according to the server retention policy.

## Attachments and media

Selecting the attachment control immediately opens a Telegram-style recent-media drawer. Its first tile is **Upload file**, which opens Android's document picker and sends the selected bytes as a file. The second tile is **Take a photo** and sends a new camera capture through the same authenticated upload pipeline with location metadata stripped. There is no video-message shortcut or overflow quality menu in this drawer.

Recent photos and videos use adaptive compression by default. A single **HQ** toggle raises media quality and gives immediate localized enabled/disabled feedback. Sending through **Upload file** is the explicit byte-for-byte original path and retains the original filename.

Documents are never automatically compressed. Compressed media preserves orientation and strips embedded location metadata by default. The client presents progress, cancellation, retry, and resumable transfer. Android stages user-selected sources into private no-backup storage and uses WorkManager so an upload can survive process death; an in-process resumable path remains available only when the optional native module is absent after an interrupted upgrade or OEM restore.

One to ten media items are sent as one album with a single caption and a predictable tile layout. Larger selections are split deterministically into groups of ten, so 23 items become 10 + 10 + 3. A single image or video preserves and shows its complete source aspect ratio within safe viewport bounds. Photo/video-only posts have no thick colored bubble frame; a hairline edge encloses the media and the timestamp/delivery state sits on a translucent island over its bottom-right corner. Media viewers expose pinch and double-tap zoom, pan to every source edge, download/save, open externally, and horizontal message navigation.

## Presence and notifications

Presence distinguishes online, idle, do not disturb, invisible, and offline. Privacy settings control who may see online and last-seen state. Presence is ephemeral and must recover after reconnect without changing durable conversation state.

Notification behavior is layered:

1. Global message and call settings.
2. Per-chat overrides.

Each visible layer supports message/call enablement, mute duration, preview visibility, sound, and mobile or desktop delivery. Quiet hours have explicit start, end, and day selection. Dormant per-server and per-channel policy data is preserved but hidden.

## Calls and voice channels

### Call forms

Direct and private-group calls start from phone or video actions in the conversation header. Incoming calls use a system notification where available and an in-app ringing surface with Accept, Accept with video, and Decline.

Dormant server voice channels remain persistent room implementations but are not reachable in the current client. If reactivated, users can continue browsing messages while connected and a compact call bar shows channel, connection quality, microphone, and disconnect controls.

### Call surface

The call surface uses a participant grid with a single active-speaker border. A compact control dock remains in the following order:

1. Microphone.
2. Camera.
3. Screen share.
4. Audio route.
5. More.
6. Leave.

The UI exposes connecting, connected, reconnecting, degraded, and failed states. A reconnect does not dismiss the call surface or require the user to rejoin manually.

### Audio controls

Before and during calls, users can configure:

- Input device.
- Output device where the platform supports selection.
- Input level meter.
- Output test.
- Automatic input sensitivity or manual threshold.
- Noise suppression: Off, Standard, High.
- Echo cancellation.
- Automatic gain control.
- Input volume.
- Per-user output volume.
- Attenuation.
- Push-to-talk and desktop keybinds.

An advanced diagnostics page shows connection region or relay, ping, jitter, packet loss, codec, bitrate, and reconnect events. Diagnostics do not occupy the normal call surface.

### Screen sharing

Web users choose a screen, window, or browser tab. Android users choose device-screen capture through the platform permission flow. Both show a preview before sharing.

Screen-share settings include:

- Resolution: 720p, 1080p, and 1440p when supported.
- Frame rate: 15, 30, and 60 fps when supported.
- Automatic or manual bitrate.
- Optimize for motion or text.
- Include system audio where the platform permits it.

Viewers choose Fit, Fill, or Actual size and Auto or Source quality.

### Media reliability requirement

Group calls and server voice channels use an SFU with adaptive simulcast or scalable video coding, TURN fallback, late-join state synchronization, active-speaker detection, and automatic reconnect. A browser peer mesh or Socket.IO audio relay is not an acceptable production group-call architecture.

## Settings

Settings are full-screen on Android and searchable two-pane navigation on desktop. Sections appear in this order:

1. **Profile**: avatar, display name, username, bio, status.
2. **Account**: password, devices and sessions, revoke sessions, delete account.
3. **Privacy and safety**: friend requests, blocked users, read receipts, last seen, online state, media metadata, link previews.
4. **Notifications and sounds**: message and call toggles, previews, sounds, quiet hours.
5. **Data and storage**: mobile and Wi-Fi auto-download rules, maximum sizes, default upload quality, cache size, clear cache, media retention, streaming.
6. **Appearance**: system, light, dark, fixed Snezhok palette, and font size. Accent, density, contrast, animation, and message-radius values are product-owned and not user-configurable.
7. **Voice and video**: devices, processing, sensitivity, quality, camera preview, push-to-talk.
8. **Accessibility**: reduced motion, higher contrast, saturation, screen-reader descriptions, caption preference.
9. **Language**: English and Russian initially.
10. **Advanced**: hardware acceleration on web, diagnostics, log export, experimental flags.
11. **Administration** for admins: members, default permissions, storage limits, and retention.

Settings use rows, toggles, radio groups, sliders, and short explanations only where the consequence is not obvious. Per-chat settings remain accessible from chat menus. Dormant per-channel and per-server settings are hidden.

## Offline, synchronization, and performance

The Android client keeps a local database for recent conversations, messages, read state, drafts, and transfer queues. The web client uses durable browser storage for the cached shell, recent messages, drafts, and pending sends.

The client must:

- Render the first 50 cached messages immediately.
- Reconcile network changes in the background.
- Queue text and file sends while offline.
- Use cursor pagination for older history.
- Run a delta sync after reconnect instead of clearing the current screen.
- Virtualize long message, channel, member, and search lists.
- Decode thumbnails at their display size.
- Lazy-load emoji data and media viewers.
- Keep usable cached content visible during refresh.

Performance targets on representative production hardware are:

- Cached shell interactive within 1.0 second on a modern desktop.
- Cached shell interactive within 1.5 seconds on a mid-range Android device.
- Cached conversation switch painted within 100 ms.
- Optimistic send feedback within 50 ms.
- No route-level spinner when cached content is available.

Skeletons appear only on an uncached initial load. A spinner never replaces usable content.

## Data migration

The clean-slate platform should preserve existing durable user content where feasible:

- Accounts and account profiles.
- Sessions where security and schema compatibility permit.
- Friendships and friend requests.
- Direct messages and groups.
- Messages, replies, reactions, pins, and read state.
- Attachments and authenticated file references.
- Mute state and notification choices.

The existing global conversation becomes a `General` text channel inside a default migrated server. The new product must not retain a special `global` branch in its user interface or client domain model.

## Explicit non-goals

- Public discovery, federation, or public server directories.
- Advertising, recommendations, algorithmic feeds, or engagement mechanics.
- Stories, short-form content feeds, or status broadcasting beyond a plain custom status.
- Bots and public application marketplaces in the initial private release.
- Novel social metaphors that duplicate chats or servers.
- Production group calls based on client peer mesh.

## Acceptance criteria

The current Android-first production release is not complete until the following are exercised on Android against the production API. Web parity is a later milestone and does not block the private APK release:

- Email registration, login, session persistence, session revocation, and logout.
- Friend request, acceptance, removal, and block behavior.
- Direct chat and private-group flows; dormant server/channel flows are excluded until reactivation.
- Text, emoji, reactions, reply, edit, delete, pin, forward, and search.
- Voice note and round-video-note gesture flows.
- Default compressed media, HQ media, and original-file transfer modes.
- Upload cancellation, retry, resume, background Android upload, and authorization failure.
- Direct call, group call, late join, reconnect, TURN fallback, and screen share.
- Notification overrides and quiet hours.
- Cached startup, offline read, offline queue, and reconnect delta sync.
- Android screen-reader traversal, 3-button navigation, gesture navigation, keyboard/inset handling, and destructive-confirmation flows.
- Empty, loading, error, offline, reconnecting, and destructive-confirmation states.
- Android viewports of 412 by 915 and 360 by 800 dp-equivalent layouts, including the Samsung Galaxy A12 class of devices.

Any screen should be rejected if it conflicts with `DESIGN.md`, displays metadata that does not support a decision, hides a frequent action behind an unexplained gesture, or requires marketing prose to understand. Cooperative activities additionally must pass the acceptance test in `COOPERATIVE_EXPERIENCES.md`.
