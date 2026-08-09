# Snezhok 2026 Experience and Design System

## Status and product feeling

This document is the authoritative design contract for new Android work. Existing screens migrate to it incrementally; a redesign is not permission to destabilize messaging, calls, cached startup, accessibility, or low-end performance.

Snezhok is a private place where people talk, make small things together, and keep the result. It should feel:

- warm, friendly, and personal rather than corporate;
- bright and expressive rather than noisy;
- immediate like a messenger rather than navigated like a content platform;
- gently playful rather than childish;
- private and trustworthy rather than engagement-driven.

The visual references establish the mood: warm off-white space, oversized confident type in rare editorial moments, bold flat color, rounded geometry, hand-drawn loops, and a small expressive character. Snezhok adapts those ingredients to a high-frequency messaging product. It does not copy reference branding, layouts, photography, or mascot art.

## Experience principles

1. **Conversation remains home.** Play, media, lists, and memories begin in a chat and return a durable result to that chat.
2. **One tap creates shared motion.** The initiating action should immediately create something both people can see or contribute to.
3. **Content before chrome.** Messages, people, photos, drawings, answers, and shared results carry more visual weight than navigation.
4. **Playfulness is concentrated.** Utility surfaces stay calm. Color and illustration peak at invitations, reveals, completions, and empty states.
5. **No punishment loops.** There are milestones, not streak anxiety, expiring guilt, public scores, or compatibility percentages.
6. **Privacy is visible.** Secret answers, locked submissions, audience, reveal conditions, and deletion consequences are stated where the decision is made.
7. **Fast is part of friendly.** Every tap acknowledges immediately. Cached content paints first. Animation never delays navigation or input.
8. **Android is authoritative.** Russian is the default language, physical Galaxy A12-class testing is required, and all layouts respect keyboard and system-navigation insets.

## Current product scope

The primary Android navigation has three destinations in this order:

1. **Чаты / Chats**
2. **Профиль / Profile**
3. **Настройки / Settings**

Servers, server channels, server administration, server notification overrides, and server entry points are dormant. Their implementation and data remain in the repository for a possible future release, controlled by the checked-in client gates at `apps/mobile/src/config/productCapabilities.ts` and `apps/web/src/config/productCapabilities.ts`. Dormant capabilities must not appear in navigation, search results, notifications, settings, administration, or deep links.

Chat and call details hide the bottom navigation. Direct switches between bottom destinations animate only the source and destination; intermediate screens never pass through the viewport.

## Visual language

### Color strategy

Use color in three layers:

- **Foundation (about 80%)**: warm canvas, white or charcoal surfaces, ink, quiet supporting text.
- **Snezhok blue (about 15%)**: navigation selection, primary actions, links, unread state, focus, and current-user identity.
- **Moment colors (about 5%)**: cooperative activity types, reveals, milestones, and small illustrations.

Do not distribute every playful color across every screen. A normal chat remains quiet; a completed color hunt may be exuberant.

#### Light foundation

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#FFF9EE` | warm snow background |
| `surface` | `#FFFFFF` | primary cards, sheets, incoming bubbles |
| `surface-soft` | `#F4EFE6` | search, inactive controls, grouped sections |
| `surface-raised` | `#FFFFFF` | dialogs and floating controls |
| `ink` | `#19202A` | primary content |
| `ink-secondary` | `#626A76` | previews and support text |
| `ink-faint` | `#9299A3` | timestamps and disabled text |
| `border` | `#E9E1D5` | structural hairlines |
| `snow-blue` | `#3F6FE5` | accessible primary action |
| `snow-blue-pressed` | `#315BC3` | pressed primary action |
| `snow-blue-soft` | `#E5EEFF` | selection and outgoing support surface |

#### Dark foundation

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#11141A` | main background |
| `surface` | `#1A1E26` | cards and incoming bubbles |
| `surface-soft` | `#222731` | inactive controls and sections |
| `surface-raised` | `#292F3A` | dialogs and floating controls |
| `ink` | `#F6F3EC` | primary content |
| `ink-secondary` | `#B1B5BE` | previews and support text |
| `ink-faint` | `#7F8692` | timestamps and disabled text |
| `border` | `#303641` | structural hairlines |
| `snow-blue` | `#7EA4FF` | primary action and selection |
| `snow-blue-pressed` | `#A0BAFF` | pressed primary action |
| `snow-blue-soft` | `#24345C` | selection and outgoing support surface |

System theme is the default. Light and dark are equally complete. High-contrast mode increases text and boundary contrast without replacing every surface with pure black or white.

#### Moment palette

| Name | Fill | Pairing | Default activity use |
| --- | --- | --- | --- |
| Lavender | `#CDB5FF` | `#5D3B93` | Question Drop, reflection |
| Coral | `#FF9184` | `#782C28` | romance, energetic reveals |
| Butter | `#FFE88A` | `#6A5300` | memories, movies |
| Lime | `#DCEF72` | `#405000` | quests, completed actions |
| Mint | `#91E3BB` | `#155C3B` | cooperative milestones |
| Tangerine | `#FFA044` | `#6B3100` | surprise and Draw & Guess |
| Sky | `#A8D8FF` | `#174C75` | songs and calm prompts |

Moment colors have fixed semantic pairings across themes. Use their dark pairing for text on light fills and a tested lighter tint for dark-mode text. Danger, warning, success, and online presence remain separate semantic colors and are never decorative.

Gradients are permitted only for the Snezhok wordmark, a rare hero/reveal background, or a generated collage treatment. Controls, settings rows, message bodies, and routine navigation use solid fills.

### Typography

Android uses the platform typeface until a bundled family with complete Cyrillic, Latin, weight, accessibility, license, and A12 startup validation replaces it. Personality comes from scale, weight, color, and composition—not an unverified decorative font.

| Token | Size / line | Weight | Use |
| --- | --- | --- | --- |
| `display` | 32 / 37 sp | 800 | onboarding and major shared reveal only |
| `page-title` | 28 / 33 sp | 800 | Chats, Profile, Settings |
| `section-title` | 20 / 25 sp | 750 | feature and sheet sections |
| `title` | 16 / 21 sp | 700 | rows, cards, chat title |
| `body` | 16 / 22 sp | 400 | messages and inputs |
| `body-small` | 14 / 19 sp | 450 | previews and descriptions |
| `label` | 12 / 16 sp | 650 | metadata, chips, timestamps |

Use sentence case. Never use uppercase paragraphs. Display type may occupy at most two lines on a phone and must not push the first action below the fold at 360 × 800 dp.

### Spacing and geometry

Use the 4 dp grid: 4, 8, 12, 16, 20, 24, 32, and 40. The normal page inset is 16 dp; compact message geometry may use 8 or 12 dp. Touch targets are at least 48 × 48 dp, with a 44 dp absolute minimum only where Android conventions require it.

| Radius | Value | Use |
| --- | ---: | --- |
| `small` | 10 dp | fields, compact controls |
| `medium` | 16 dp | rows, bubbles, menus |
| `large` | 24 dp | feature cards, sheets, large media |
| `hero` | 32 dp | rare reveal or empty-state panel |
| `round` | 999 dp | avatars, chips, icon buttons |

Rounded does not mean nested. A screen may have a section card and a control inside it; it should not place a card inside a card inside another tinted card. When hierarchy is already clear from spacing or color, remove the border.

### Elevation and borders

Routine lists use spacing and hairlines. Cards on the warm canvas may use a soft boundary or one low shadow, not both at full strength. Bottom sheets and menus use one consistent elevation. Backdrop opacity animates independently from panel position so the sheet is at its final elevation on the first rendered frame.

### Icons and expressive graphics

- Use the existing coherent Tabler-style line family, 1.8–2.0 visual stroke.
- Use filled variants only for active bottom navigation or a binary selected state.
- Interface actions do not use emoji as their only icon.
- The ✦ Big Button is a deliberate product symbol and always has an accessible label.
- Decorative loops, snow puffs, flowers, or stars use simple flat vectors and one stroke language.
- The Snezhok character is a small, friendly snow puff/snowflake—not a copy of the reference flower. It appears in onboarding, empty states, activity instructions, and celebratory results, never beside every message or setting.
- Photography is user content first. Stock lifestyle photography does not appear inside the authenticated product.

## Component grammar

### Buttons

- **Primary:** solid snow blue, white label, 48–52 dp height, medium radius. One primary action per decision surface.
- **Secondary:** soft surface with ink label and optional leading icon.
- **Quiet:** text or icon on transparent background for reversible utilities.
- **Destructive:** danger text or fill only after the user has entered a destructive flow.
- **Play:** moment-color fill with ink pairing; label describes the action, such as “Ответить тайно”.

Buttons acknowledge touch within one frame through opacity, scale no smaller than 0.97, or color. Haptics support meaningful selection, start, reveal, success, and destructive confirmation; they do not fire on every scroll or keypress.

### Fields

Fields have persistent labels when the meaning could become ambiguous after entry. Placeholder text is an example, never the only label. Errors appear adjacent to the field and keep user input intact. Search is a compact soft-surface field; the message composer is its own component, not a generic form field.

### Cards

Cards are for a durable object or grouped decision: a shared activity, paired songs, movie, capsule, or settings section. They are not wrappers for every list row. Every card has one dominant content area and no more than two visible actions; additional actions go into a styled sheet.

### Chips and segmented controls

Chips represent a filter, category, person, or compact state. They do not replace ordinary buttons. Selected chips use fill plus text contrast, not color alone. Segmented controls have two to four mutually exclusive options and a shared container.

### Sheets and dialogs

Android uses Snezhok sheets for choice lists, activity launch, reactions, and contextual actions. Centered dialogs are reserved for short blocking decisions, security, and destructive confirmation. No default Android-looking confirmation dialog is accepted where the styled application surface can be used.

Sheets slide 160–220 ms with ease-out; the backdrop fades 120–160 ms. Keyboard-bound sheets resize or pan deliberately and never jump behind three-button navigation.

### Navigation

The bottom bar is quiet, fixed, safe-area aware, and contains Chats, Profile, and Settings. Labels remain visible. The active item may use a compact snow-blue soft capsule behind its icon; the entire bar must not become a floating glass pill.

Top bars contain identity/title on the left and at most three high-frequency actions on the right. Overflow holds the rest. In a direct chat, reserve one prominent ✦ action for cooperative experiences once that framework is available; do not add several game icons.

## Messaging surface

Messaging behavior remains Telegram-like:

- cached recent messages paint immediately and the chat opens at the newest message;
- direct and group messages use restrained bubbles with real aspect-ratio media;
- one check means accepted by the current protocol; two checks require actual remote read state;
- double tap applies a heart; tap opens the compact reaction picker;
- swipe replies; long press selects the whole message with animated left-gutter checks;
- selected bubbles shift smoothly and actions use short labels;
- optimistic sends and mutations reconcile without duplicates;
- selection UI clears immediately after an action begins instead of waiting on the network.

The normal chat background is foundation color, not a collage of decorative shapes. Optional wallpaper may add a very low-contrast Snezhok pattern. Cooperative activity cards appear in the same chronological stream and use moment color to distinguish themselves from messages.

### Composer

The resting composer contains attachment, expanding text input, and voice/send control. The cooperative ✦ entry belongs in the header, not inside the already dense composer. Reply and edit context occupy one compact strip above the field. Recording keeps the existing hold, slide-to-cancel, slide-to-lock, live waveform, and Samsung fallback behavior.

### Activity cards in chat

Every cooperative activity renders from one shared card grammar:

1. Type icon and short label.
2. Human prompt or object title.
3. Participant state using avatars and plain language.
4. One current action for the viewer.
5. A compact result after completion.

Waiting cards say who or what is awaited without nagging. Secret contributions never expose length, typing, choice, thumbnail, metadata, or partial result before the reveal rule succeeds. Completion updates the existing card and may add one concise system event; it does not flood the chat with every internal step.

## Media, calls, profile, and settings

Media keeps authenticated URLs, immediate drawers, Upload File as the first tile, one HQ toggle, album batching of ten, progress, thumbnail-first rendering, polished viewing, and correct aspect ratios. Cooperative photo submissions reuse the same transfer and privacy pipeline.

Calls stay visually calmer than activity reveals. Participant video dominates; controls use dark neutral surfaces and snow blue for active state. Connection, reconnecting, degraded, and failed states are explicit. Screen sharing, audio route, foreground service behavior, and LiveKit reliability rules remain unchanged by the redesign.

Profile may use one expressive color field behind the avatar and name, followed by flat sections. It is not a social feed. Settings use grouped warm/neutral surfaces, clear rows, switches, and choice sheets. Moment colors can identify categories in small icons but do not tint every settings card differently.

## Motion and feedback

| Interaction | Duration | Treatment |
| --- | ---: | --- |
| Press feedback | 70–110 ms | color/opacity and optional 0.97–1 scale |
| Tab destination | 160–190 ms | direct horizontal source-to-destination |
| Sheet | 180–220 ms | upward ease-out; independent backdrop |
| Activity card update | 180–260 ms | local crossfade/resize, no list-wide layout storm |
| Secret reveal | 300–450 ms | one intentional mask/flip/fade sequence |
| Milestone | up to 700 ms | bounded, dismissible, never blocks chat |

Use Reanimated/UI-thread motion for gestures and per-frame transforms. Do not animate entire FlashList trees, waveform progress through global Zustand state, ambient decorative loops, parallax, or continuous gradients. Reduced motion replaces spatial/celebratory motion with immediate state plus a short opacity transition.

Skeletons appear only when no cached content exists. Existing content never disappears behind a route-level spinner. Offline, retrying, waiting, locked, revealed, completed, expired, and failed states are designed states—not toast-only afterthoughts.

## Language and tone

Russian ships first and English ships in the same change. Copy is warm, short, and specific:

- Prefer “Ждём ответ Наташи” to “Ожидание ответа другого участника”.
- Prefer “Открыть вместе” to “Инициировать совместное раскрытие”.
- Never shame inactivity or imply relationship quality from app usage.
- Avoid generic encouragement, therapy claims, romance assumptions, and marketing prose inside routine screens.
- NSFW and romantic categories use explicit names and consent; they are never selected by Surprise unless both participants enabled them.

## Accessibility and device constraints

- Support 200% Android font scale without hiding primary actions.
- Meet WCAG AA contrast for text and controls; moment color is never the only state signal.
- Provide roles, labels, selected/checked/disabled state, and predictable screen-reader traversal.
- Describe user images only from user-provided captions; do not invent visual meaning.
- Minimum targets remain 48 dp where practical.
- Test 360 × 800 and 412 × 915 dp-equivalent layouts, gesture navigation, three-button navigation, keyboard open/closed, rotation-sensitive call/share surfaces, and Russian expansion.
- On the Samsung A12, cached shell interaction targets 1.5 seconds, chat switch paint 100 ms, and optimistic feedback 50 ms as defined by the performance budgets.

## Screen implementation order

The redesign is migrated vertically, not by replacing every primitive at once:

1. Tokens, foundation surfaces, type scale, icons, bottom navigation, headers, sheets, and buttons.
2. Chats list and direct-chat shell without changing message reliability behavior.
3. Profile and Settings using the same primitives.
4. Cooperative activity card and ✦ launch sheet.
5. Individual cooperative activities in the order defined by `COOPERATIVE_EXPERIENCES.md`.
6. Authentication, calls, media viewers, and remaining secondary surfaces.

Each slice must be shippable, physically testable, and reversible. Do not maintain old and new component styles indefinitely; migrate shared primitives and remove the superseded visual path after its consumers move.

## Review checklist

A screen is not ready unless all answers are yes:

- Is the frequent action obvious without explanatory copy?
- Is there one dominant action and a clear next state?
- Does it use only foundation, Snezhok blue, and at most one moment family?
- Are nested cards, pills, shadows, and decorative art structurally justified?
- Does interaction acknowledge within one frame and reconcile safely?
- Do loading, empty, offline, failure, waiting, and completed states preserve context?
- Does Russian fit at 360 × 800 dp and at increased font scale?
- Are touch, screen-reader, contrast, motion, safe-area, and keyboard rules satisfied?
- Does it remain smooth on a physical Galaxy A12-class device?
- For cooperative work, does one action affect both people, require meaningful contribution, and leave a useful result in chat/history?
