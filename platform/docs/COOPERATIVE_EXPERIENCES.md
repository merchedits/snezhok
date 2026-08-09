# Cooperative Experiences

## 4.0 implementation status

The 4.0 Android/API release implements the shared framework and the complete first direct-chat set: Question Drop, Blitz, Tiny Quest, Color Hunt, Song Exchange, Movie List, Draw & Guess, Ideas Jar, Memory Capsule, the ✦ launcher, and derived milestone cards. Activity cards are ordinary cached chat messages, commands use client idempotency keys plus expected revisions, and all private projections are built on the server. Chat history embeds compact activity summaries; potentially large list, drawing, and revealed-capsule detail is fetched only when the card opens so it does not inflate every cached message page on A12-class devices.

The current Color Hunt result is a deterministic paired 3 × 3 grid rendered from the eighteen authenticated source photos. A future media-worker derivative may add a single downloadable collage artifact without changing activity state. Song Exchange keeps a shared musical diary in chronological chat history. Memory Capsules accept text, up to four photos, and an optional song link, with one-month or six-month reveal choices; 4.0 locks automatically when both contributions are present and shows the authoritative server reveal date on the locked card. Yandex Music playback is an external app/universal-link handoff: Yandex's current official support documents sharing playlists and using its Android app, but does not publish a third-party playback/playlist-write API for this integration. Snezhok therefore does not scrape pages, copy cookies, proxy audio, or claim embedded native playback. See [Yandex Music playlists](https://yandex.ru/support/music/ru/collection/playlists) and [official Android app availability](https://yandex.ru/support/music/ru/new-template/appmusic).

## Product contract

Snezhok activities turn a private conversation into a small shared action:

> one tap → something happens for both people → both contribute → the result stays in the chat/history

Direct conversations are the first supported audience. Private groups may be added only after participant, quorum, privacy, and late-join rules are designed explicitly. Activities are part of messaging, not a separate game lobby, feed, or tab.

The framework must make a simple activity cheap to build without giving each activity unrelated navigation, cards, loading behavior, notifications, or persistence.

## Universal flow

1. A person taps ✦ in a direct-chat header.
2. A compact roulette offers **Ask us**, **Give us a quest**, **Play something**, **Pick for us**, and **Surprise us**.
3. A single tap either creates the selected activity immediately or opens one short safety/parameter step when required.
4. One authoritative activity card is posted to the chat for both participants.
5. Each participant contributes from that card. Optimistic local state appears immediately.
6. The server evaluates the reveal/completion rule transactionally.
7. The same card becomes the durable result. Important completions may add one concise timeline event.
8. The result remains searchable and can be revisited from chat media/activity history.

Do not show an enabled ✦ entry before at least one end-to-end activity is available. Do not launch a blank “Games” hub and ask users to navigate through categories before anything happens.

## Shared state model

Every activity instance has:

- stable ID, conversation ID, type, schema version, creator, and creation time;
- participants captured at creation;
- lifecycle state and current round/step;
- public configuration and private participant-specific configuration;
- participant contributions with server receipt time;
- reveal rule, completion summary, expiry when relevant, and deletion state;
- one chat timeline anchor and auditable mutation events.

The common lifecycle is:

`created → waiting/active → reveal-ready → revealed/completed`

Optional terminal states are `declined`, `expired`, and `cancelled`. Reopening an old client must reconstruct the card from durable server state. Socket events accelerate the UI but are not the source of truth.

Create, contribute, reveal, reroll, confirm, and complete mutations require client idempotency keys. Repeated taps, reconnects, HTTP/realtime races, and process death must never create duplicate activities or contributions.

## Privacy and consent

- Secret contributions are authorized per participant and inaccessible to the other participant until the reveal rule is committed.
- The API must not leak secret text, choices, byte length, thumbnails, waveform, attachment metadata, edit history, or timing detail that reveals the answer.
- A participant can replace their own contribution until it is locked unless the activity explicitly says otherwise.
- The card clearly distinguishes **saved**, **locked**, **waiting**, and **revealed**.
- Romantic and NSFW content are separate opt-in categories. Surprise excludes them unless every participant has opted in for that conversation.
- Decline and stop are always available without a guilt message or visible penalty.
- Blocking, leaving a conversation, account suspension, and content deletion define predictable activity access and notification behavior.
- Media submissions reuse authenticated upload authorization and metadata-stripping rules.
- Memory Capsule must not claim cryptographic secrecy unless ciphertext and key handling actually enforce it. “Locked until” describes product access control, not encryption.

## Activity card grammar

All activity cards share these regions:

1. **Identity:** activity icon, short type label, and optional round/date.
2. **Prompt/object:** the question, quest, movie, song pairing, drawing, or capsule title.
3. **People:** two avatars with status described in text as well as color.
4. **Action:** exactly one primary action for the viewer.
5. **Result:** compact completed output, expandable for details.

Use one moment-color family per type. A pending card is calm. Reveal animation is local to the card. Cards render efficiently as memoized message-row content and do not subscribe to high-frequency global state.

Notifications are invitations or state changes, not pressure. Examples: “Тёма ответил — теперь твоя очередь” and “Ваши ответы открыты”. Do not send repeated reminders automatically.

## The Big Button

The chat header ✦ is the single playful entry. Its launch sheet contains:

- **Спросить нас / Ask us** — Question Drop.
- **Дать задание / Give us a quest** — Tiny Quest or Color Hunt.
- **Поиграть / Play something** — Blitz or Draw & Guess.
- **Выбрать за нас / Pick for us** — Activity Jar or Movie List.
- **Удивить / Surprise us** — a safe eligible choice based on both users' consent and unfinished activity limits.

The sheet remembers no manipulative “recommended” ranking. Surprise may use recent history to avoid repetition, but it does not optimize engagement. If an activity needs options, show no more than one follow-up sheet before posting it.

## Activity specifications

### Question Drop

Categories are **silly**, **childhood**, **preferences**, **hypothetical**, **deep**, **romantic**, **NSFW**, and **completely random**. Russian prompts are authored first and English prompts are equivalent adaptations rather than literal low-quality translations.

Launch options:

- category;
- open answers or **Answer secretly**;
- optional reroll before the first answer only.

Open answers may appear as they are submitted. Secret answers unlock atomically only when both are locked. The completed card shows both answers side by side or stacked in a consistent participant order. It can be replied to like any chat item.

Prompt content is versioned and moderated as product content, not embedded ad hoc in clients. Avoid therapy diagnosis, coercive intimacy, humiliation, financial/medical advice, and questions that expose another person's secret without consent.

### 60-Second Blitz

One session contains 5–10 concise either/or prompts. Both participants can progress independently during a soft 60-second window; network latency never invalidates an already submitted choice.

During play, the other person's choices remain hidden. At completion, show:

- same choices grouped as **Same brain**;
- different choices grouped as **Different picks**;
- skipped or timed-out prompts neutrally.

There is no compatibility score, relationship grade, leader, winner, or penalty. The result card preserves the individual choices and can launch another round without duplicating the old result.

### Tiny Quest

A quest asks each participant for one small real-life contribution, usually a photo and sometimes short text. Examples include a favorite color nearby, a strange nearby object, the current drink, or something reminiscent of childhood.

Submissions stay locked until both contribute. The result pairs the two contributions in one media card. Camera and library choices use the normal Android permission and upload flows; failure on one upload does not reveal the other participant's locked media.

#### Color Hunt

Each participant receives a distinct color from an accessible palette. They photograph objects dominated by their assigned color. Progress is private by default except for a neutral count such as “6 of 9 found”.

At nine accepted photos per participant, the 4.0 client creates a deterministic 3 × 3 visual collage for each person inside the durable paired result. The chat result keeps links to every authenticated source photo. A later media-worker job may materialize downloadable collage derivatives. Automated color validation, if introduced, is advisory and never rejects meaningful user content without a manual override.

### Song Exchange

A prompt asks each person for one song. Inputs may begin with a shared link, search result, or supported music-provider handoff. The completed card pairs artwork, title, artist, prompt, contributor, and provider action.

Over time, completed exchanges form a shared musical diary. Playlist export/synchronization is explicit and reversible.

Yandex Music is the preferred integration target, but implementation must pass a provider discovery gate:

- use documented provider APIs, Android intents/universal links, and permitted metadata/artwork only;
- never scrape authenticated pages, embed user cookies, bypass subscriptions/DRM, or proxy copyrighted audio without rights;
- keep OAuth/provider credentials out of the client and repository;
- fall back cleanly to paste/share link and “Open in Yandex Music” when full playback or playlist APIs are unavailable;
- label previews honestly and do not call a web preview “native playback”.

Provider capability, terms, regional behavior, account linking, playback handoff, and background audio must be reverified immediately before implementation because they can change independently of Snezhok.

### Movie List

A conversation owns one shared list with **Want to watch**, **Watched**, and optional **Skipped** state. Either person can add a title, poster/link, year, and note. Duplicate suggestions reconcile into one item.

After watching, each person independently rates from 1 to 10. The shared score is the arithmetic mean of submitted ratings, displayed with one decimal only when needed: 9 and 5 become 7. Individual ratings remain visible; the average never replaces them. One rating is shown as “Тёма: 9/10”, not as a misleading shared score.

Picking a movie supports filters and one random choice. Reroll is available, but confirming a pick posts one compact choice card rather than every reroll to chat.

### Draw & Guess

The drawer receives a private word and a simple touch canvas: one pen, a small color set, eraser, undo, clear, and submit. No layers, imported images, text tool, or shape recognition are needed for the first release.

The guesser submits guesses from the activity card or ordinary chat reply. Correct matching is case-insensitive and tolerant of Russian `ё/е`; synonyms require authored aliases or drawer confirmation. The result stores the drawing, word, attempts, and completion time. The fun is the imperfect drawing, not competitive ranking.

### Shared Activities Jar

The conversation owns a jar of date/activity ideas. Either participant may add, edit their own, archive, or suggest completing an idea. Items have **available**, **picked**, and **completed** state.

Random pick is server-authoritative so both people see the same item. Rerolls update the pending selection without filling chat history. Either participant confirms completion; if disagreement matters, completion waits for the second acknowledgement. Completed ideas move to a scrapbook view with date, optional note, and media.

The feature is named **Банка идей / Ideas Jar** by default so it works for friends as well as couples. “Date ideas” may be an optional conversation label.

### Memory Capsule

A capsule combines one contribution from each participant: text, photo, or song, plus an optional “what was today like?” note. Participants choose a supported reveal time such as one month or six months.

The capsule locks only after both contributions. The launch step states the chosen delay, and after locking the chat card shows contributors and the exact server-authoritative reveal date without private previews. Server time authoritatively unlocks it; notification is best-effort and reopening later still reveals correctly.

The revealed capsule becomes a normal durable result with the original creation date and reveal date. Users can delete their own source content according to messaging policy; the UI must explain how that affects the paired capsule.

### Cooperative milestones

Milestones summarize shared history without daily obligations. Examples:

- answered 25 questions;
- completed 5 watched movies;
- created 10 memories;
- found the first Same Brain match;
- finished the first Color Hunt.

Counters derive from durable completed activity state. No streaks, missed-day warnings, leaderboards, relationship levels, compatibility scores, artificial currency, or paid recovery mechanics. A milestone produces one tasteful card or scrapbook badge and then gets out of the way.

## Scrapbook and history

The first release relies on chronological chat cards and search. A later chat-info **Together / Вместе** section may group completed questions, quests, songs, movies, drawings, ideas, capsules, and milestones. It is a projection of the same durable objects, not a second copy.

Filters are object types, not algorithmic recommendations. Export and deletion respect attachment authorization and conversation membership. There is no public profile showcase.

## Reliability and performance

- Cache active activity cards with the same owner/account boundaries as messages.
- Fetch compact card summaries in message history; load heavy detail only when expanded.
- Keep prompt packs and small choice sets versioned and cacheable.
- Upload photos/audio through resumable background transfer and show 0–100% progress.
- Generate collages and derived art in the bounded media worker, never on the chat JS thread.
- Cancel obsolete requests and reconcile socket/HTTP responses by activity revision.
- Use database constraints for participant uniqueness, one contribution per round, idempotency, and one timeline anchor.
- Activity failure never prevents ordinary chat from opening or sending.

## Delivery sequence

### Foundation release

- Common activity contracts, tables, authorization, idempotent events, and chat-card message kind.
- Shared Android activity card, launch sheet, cache/reconnect behavior, notifications, analytics-free diagnostics, and moderation/content versioning.
- Question Drop with open and secret answers.
- ✦ Big Button enabled only after the above works end to end.

### Second release

- 60-Second Blitz.
- Tiny Quest photo pairing.
- Cooperative milestone foundation.

### Third release

- Ideas Jar.
- Movie List and independent/shared ratings.
- Together history projection.

### Provider-dependent release

- Song Exchange link flow first.
- Yandex Music account/search/playback/playlist enhancements only after the provider discovery gate.

### Media-intensive release

- Color Hunt and server-generated collages.
- Draw & Guess.
- Memory Capsule.

Each release requires focused contract/API/mobile tests, full relevant suites, production migration/backup review, signed APK verification, and physical two-account Android validation. Secret/reveal behavior must be tested with one device offline, retries, app process death, clock disagreement, duplicate taps, account blocking, and reconnect races.

## Acceptance test for any activity

An activity is not ready unless:

- one tap creates a visible shared object;
- both participants see the same authoritative state;
- each has a meaningful contribution or acknowledgement;
- secret data cannot be inferred or fetched early;
- duplicate taps and reconnects remain idempotent;
- the result survives restart and stays in chat/history;
- ordinary messaging stays available throughout;
- decline, expiry, failure, deletion, offline, and accessibility states are complete;
- Russian and English copy fit at supported font scales;
- the release stays within Galaxy A12 interaction and memory budgets;
- physical two-account testing passes.
