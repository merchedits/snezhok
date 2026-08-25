# Snezhok Design Language

This is the authoritative visual and interaction contract for Android. The source brand package is `Design Language/`; this document translates it into implementation rules. Android remains the product reference. Russian is primary and English ships alongside it.

## Brand character

Snezhok is playful, not childish; bold, not noisy; social, not clinical; and unusual only in small, deliberate doses. It should feel like a private, well-designed place shared by people who know each other—not a toy, enterprise dashboard, generic AI product, or engagement machine.

The composition is 80% functional calm and 20% expression. Color establishes hierarchy. Space carries more weight than outlines. Photography and messages remain content; decoration never competes with them.

Conversation stays home. Shared activities begin with one action, involve both people, and leave a durable result in chat. There are milestones but no punitive streaks, compatibility scores, or guilt mechanics.

## Fixed identity

Accent customization is not exposed. Snezhok has one mandatory identity:

| Token | Value | Purpose |
| --- | --- | --- |
| Milk | `#FFF7E8` | main light canvas |
| Ink | `#17131A` | primary text and dark canvas |
| Electric Violet | `#6437F5` | identity, navigation, primary actions, outgoing messages |
| Acid Lime | `#D7FF29` | creation, selected state, reveal accent |
| Pink | `#FF7EA8` | identity and social/editorial moments |
| Orange | `#FF8A1F` | energetic activity moments |
| Sky | `#62B8FF` | calm activity moments |
| Lavender | `#DCC8FF` | reflection and secondary violet moments |
| Mint | `#BDEFCF` | success and cooperative moments |
| Fog | `#EFE9DF` | quiet controls and separators |
| Warm incoming | `#F1EBDD` | incoming bubbles and neutral groups |

Soft group surfaces are Violet `#E3D4EA`, Lime `#F8F8C6`, Pink `#FFE1DC`, Orange `#FFE3C4`, and Sky `#E3ECEC`.

Use one dominant color per screen and no more than one supporting brand accent. Routine authenticated UI is neutral Ink/Surface in dark mode or Milk/Warm in light mode; Violet carries identity and Lime marks the single selected or primary state. Pink, orange, sky, and mint are reserved for activity content and mascot/sticker artwork, never routine settings or navigation. Never assign random colors to list rows or settings icons.

Gradients are limited to one rare hero/reveal or brand artifact per screen. Routine controls and messages use flat color. Semantic danger, warning, success, online, and disabled colors never become decoration.

Dark mode uses Ink/deep warm surfaces, not gaming-neon black. Violet and Lime retain their roles. Every semantic foreground/background pair must meet WCAG AA.

## Typography

Onest is the product family, embedded in the APK with Cyrillic and Latin weights 400–900. Use sentence case.

| Role | Size / line | Weight |
| --- | --- | --- |
| Display | 32 / 38 | 800–900 |
| Page title | 28 / 33 | 800 |
| Section title | 20 / 25 | 700–800 |
| Row/card title | 16 / 21 | 700 |
| Body/message | 16 / 22 | 400 |
| Supporting body | 14 / 19 | 400–500 |
| Label/metadata | 12 / 16 | 600–700 |

Display type belongs only to onboarding, a major empty state, or a shared reveal. It may occupy two lines at most. Routine screens must not shout in all caps.

## Icons

Phosphor is the only interface icon family. Bold is the default weight; Fill is reserved for selected navigation or a binary selected state. Icons normally use Ink, Violet, or the current semantic foreground. Emoji is content, never the sole control glyph. The sparkle is a deliberate cooperative-action symbol and always has an accessible label.

Do not mix Phosphor with Tabler, platform Material icons, arbitrary SVG styles, or emoji buttons.

## Geometry and spacing

Use the 4 dp rhythm: 4, 8, 12, 16, 20, 24, and 32. Page padding is 20 dp; section rhythm is 24–32 dp. Compact message internals may use 8–12 dp.

| Geometry | Value |
| --- | ---: |
| Micro radius | 4 dp |
| Control radius | 12 dp |
| Card/bubble radius | 18 dp |
| Hero radius | 24 dp |
| Navigation dock radius | 26 dp |
| Semantic pill | 999 dp |

The minimum target is 44 dp and should be 48 dp where practical. A pill is allowed only for a filter, status, segment, or compact selection. Ordinary cards and buttons are not pills. Avoid nested rounded rectangles; when spacing or fill already establishes hierarchy, remove the border.

## Elevation and decoration

Shadows belong only to genuinely floating layers: the bottom dock, floating creation action, menu, sheet, or dialog. Use a soft short shadow, never a hard offset cartoon shadow. Virtualized rows and message bubbles have no shadow.

A routine card does not need an Ink outline. Dividers use Fog or a hairline. At most two large, flat, partially off-canvas editorial motifs may appear on an otherwise calm screen. No random snowflakes, confetti wallpaper, decorative spark on every section, or mascot beside routine controls.

The mascot is limited to onboarding, loading, empty, success, and sticker/celebration contexts. It never replaces content or becomes a permanent navigation ornament.

## Core components

### Buttons

- Primary: Violet with white label, 48–52 dp high, 12 dp radius.
- Creation/selected: Lime with Ink label.
- Secondary: warm/soft surface with Ink label.
- Quiet: transparent icon or text for reversible utilities.
- Destructive: danger treatment only inside a destructive flow.

One decision surface has one dominant action. Press feedback uses color, opacity, or scale no smaller than 0.96 and acknowledges within one frame.

### Fields and search

Fields use warm or Fog surfaces, 12 dp radius, calm borders only for focus/error. Search is quiet and does not receive a decorative shadow. Placeholder copy is an example, not the only label when ambiguity would remain.

### Cards and lists

Cards represent a durable object or grouped decision—not every row. A card has one dominant content area and at most two visible actions. Chat and contact lists are mostly neutral; Saved Messages or another singular special object may receive a soft branded surface.

### Sheets and dialogs

Choice lists, reactions, activity launchers, and contextual actions use Snezhok sheets. Sheets have a 26 dp top radius and one floating-layer shadow. The backdrop fades independently while the sheet moves upward. Centered dialogs are reserved for security, destructive confirmation, and short blocking decisions. Do not show stock Android dialogs where a styled surface is appropriate.

## Navigation

The current primary destinations are Chats, Profile, and Settings. The selected bottom-navigation item is one complete Lime capsule containing both icon and label. It has no Android ripple rectangle, shadow, or glow. Server code remains dormant behind checked-in capability gates and must not appear in navigation, search, notifications, administration, or deep links.

The bottom dock is Violet on a Milk screen. Unselected items use a soft white foreground. The selected icon/label sits on a Lime island with Ink foreground and uses the Fill icon weight. Labels stay visible. Safe-area padding is outside the dock so the dock never sits under Android navigation controls.

Direct tab changes animate only source and destination. A chat, profile detail, media viewer, or call hides the dock. Headers are flat and calm, with a 28 dp page title or compact chat identity and no more than three frequent actions.

## Screen contracts

### Chats

Neutral canvas and rows with a Lime creation action. The small private deployment does not expose global chat-list search, folders, or archive filters; search remains available inside an opened conversation. Saved Messages may use Soft Violet. No random per-row palette and no outlined card around every conversation.

### Chat

Messages dominate. Incoming bubbles are Warm with Ink; outgoing bubbles are Violet with white. Bubbles have no normal border or shadow and use a tighter sender-side top corner. Single photo/video messages are content-first cards: no colored bubble padding, only a hairline neutral edge, the complete source aspect ratio within safe viewport bounds, and one translucent bottom-right island for time and delivery state. Media reactions occupy a matching bottom-left island. Text-message reactions and time share one compact footer row instead of stacking into separate vertical levels. Albums retain their intentional cropped mosaic, while full-screen viewers always expose the complete authenticated source. Selection adds Violet boundary/checks without permanently changing normal geometry.

The composer is a calm Milk/Warm strip with a warm field, quiet attachment control, Violet send control, and existing voice gesture behavior. The sparkle cooperative launcher stays prominent in the header. The chat identity header, pinned banner, and active voice-note controls remain outside the keyboard-translated region; opening the keyboard may move the timeline and composer but never the top actions. Pinned/reply/edit states use compact soft group surfaces.

### Profile

Milk canvas with one large Pink identity/portrait stage as the dominant expressive area. Profile photos form a swipeable, edge-to-edge hero gallery with a quiet position counter; tapping any photo opens the authenticated full-screen viewer with previous/next navigation. The identity card overlaps the lower edge of the hero so name and biography remain anchored while photos stay visually primary. Owners manage the same gallery below the identity card; contacts return to neutral Warm rows. It is a personal identity page, not a social feed or collage of colored cards.

### Settings

Settings use one neutral card surface throughout, Violet icons, Lime selection controls, and quiet semantic danger only where needed. Density, contrast, reduced-animation, and message-radius controls are not exposed: Snezhok owns these values as part of its design system. Accent color selection is absent.

### Authentication

Violet may dominate the whole stage. Identity copy is white, fields are warm/light, and the main action is Lime with Ink. Decoration stays editorial and sparse.

### Calls and media

Calls remain calmer than activities: participant video dominates, dark Ink surfaces support it, Violet marks active controls, and state is explicit. Viewers prioritize content with minimal custom controls. Reliability, authenticated media, safe areas, LiveKit behavior, foreground services, and the Samsung recorder fallback are not changed by styling.

### Cooperative activities

The sparkle menu may be more expressive than routine messaging while staying within the fixed families. Games/moments and persistent shared collections are separate catalog groups: movie lists and idea jars never show waiting, decline, or cancel-session language. Every activity card contains: type and icon, a distinct human prompt when one exists, participant or collection state, one current action, and a compact durable result. A label may never be repeated immediately as a second title; when both resolve to the same text, render it once. Inside an activity sheet, the actual question or task is the primary typographic element; the activity type is a smaller orientation label. Closing the sheet is a reversible dismissal, while at most one clearly named terminal action may cancel or decline a session and always requires confirmation. Secret input reveals no partial answer or metadata. Activity steps update one chronological chat object rather than flooding the conversation.

## Motion

| Motion | Duration |
| --- | ---: |
| Micro feedback | 160 ms |
| Standard UI transition | 230 ms |
| Expressive reveal | 320 ms |
| Celebration maximum | 500 ms |

Use gentle ease-out with a small overshoot only where it improves tactility. Reanimated/UI-thread transforms handle gestures and per-frame motion. Never animate the full FlashList, drive waveform/video progress through global state, or run continuous ambient decoration. Reduced motion replaces spatial motion with immediate state and a short fade.

## Language, accessibility, and performance

Copy is warm, short, and specific. It never shames inactivity, diagnoses a relationship, or makes therapeutic claims. Romantic/18+ content is explicit and consensual and is never selected by Surprise unless both people enabled it.

Support Android font scaling without hiding primary actions. Controls expose labels, roles, checked/selected/disabled state, and predictable traversal. Color is never the only state signal. Every bottom action surface reserves at least 16 dp beyond a zero inset and adds space to reported three-button-navigation insets. Text-entry sheets move as one unit with the synchronized keyboard animation so the focused field and primary action remain visible. Verify 360×800 and 412×915 layouts, Russian expansion, keyboard open/closed, gesture and three-button navigation.

Cached content paints first. Navigation and optimistic feedback remain immediate. Decorative work must be compositor-cheap. Physical Samsung A12-class testing remains required before calling performance or native media behavior verified.

## Review gate

A surface is ready only when all are true:

- The frequent action is obvious and one action dominates.
- The 80/20 calm-to-expression ratio is visible.
- It uses Onest, Phosphor, Milk/Ink, fixed Violet, and controlled Lime/supporting accents.
- No random row colors, unjustified pills, nested cards, hard shadows, or decorative clutter remain.
- Loading, empty, offline, failure, waiting, and completed states preserve context.
- Russian, increased font scale, touch targets, contrast, safe areas, and keyboard behavior work.
- Messaging/media/call reliability behavior is unchanged or explicitly tested.
- Cooperative actions affect both people and leave a useful result in chat/history.
