# Snezhok Design System

## Design direction

Snezhok uses Telegram's restraint for messaging and Discord's information architecture for servers and calls. The design is minimal because irrelevant elements are removed, not because the interface is sparse, oversized, or ornamental.

The visual system must feel like a well-maintained communication tool. It must not resemble a generated product landing page or a collection of unrelated component-library samples.

## Non-negotiable rules

- Use established chat, server, channel, call, and settings patterns.
- Give content more visual weight than navigation chrome.
- Use one accent color with semantic status colors.
- Separate structure with spacing, surface shifts, and hairline borders.
- Keep common actions visible or in conventional context menus.
- Use labels that describe actions directly.
- Explain only consequences that are not obvious.
- Show advanced diagnostics only when requested.

The following are prohibited in the authenticated product:

- Hero panels.
- Eyebrow or kicker headings.
- Inspirational empty-state copy.
- Feature cards.
- Gradient or animated-gradient fills.
- Glassmorphism and background blur as decoration.
- Floating blobs, decorative illustrations, confetti, or shimmer.
- Arbitrary pastel accent palettes.
- Oversized headings or metrics.
- Nested rounded containers without structural purpose.
- Pill-shaped treatment for every button, field, or row.
- Marketing phrases such as “Make it yours” or “Shape how you appear.”

## Design tokens

### Typography

Web uses the native system stack:

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
```

Android uses Roboto through the platform typography system. Do not bundle a decorative display face.

| Token | Size | Line height | Weight | Use |
| --- | ---: | ---: | ---: | --- |
| `label-xs` | 12 px | 16 px | 500 | timestamps, metadata, key hints |
| `body-sm` | 14 px | 20 px | 400 | previews, secondary rows, settings detail |
| `body-md` | 16 px | 22 px | 400 | messages, inputs, primary rows |
| `title-sm` | 16 px | 22 px | 600 | conversation and section titles |
| `title-md` | 20 px | 26 px | 600 | page titles, dialog titles |
| `title-lg` | 28 px | 34 px | 700 | authentication and empty top-level pages only |

Android maps these to equivalent `sp` values and respects the system font-scale setting. Body text never uses all caps. Section labels can use 12 px semibold sentence case; letter spacing is not exaggerated.

### Spacing

Use a 4 px base grid:

| Token | Value |
| --- | ---: |
| `space-1` | 4 px |
| `space-2` | 8 px |
| `space-3` | 12 px |
| `space-4` | 16 px |
| `space-6` | 24 px |
| `space-8` | 32 px |

Avoid one-off gaps unless media geometry requires them. Desktop interactive targets are at least 36 by 36 px. Mobile targets are at least 48 by 48 dp, with no target smaller than 44 by 44 CSS px on compact web layouts.

### Radius

| Token | Value | Use |
| --- | ---: | --- |
| `radius-sm` | 6 px | fields, buttons, selected rows |
| `radius-md` | 10 px | menus, popovers, media cards |
| `radius-lg` | 16 px | direct-message bubbles, large dialogs |
| `radius-round` | 999 px | avatars, presence dots, compact badges |

Server channel messages do not use a container radius because they do not use bubbles.

### Color

The default theme is dark. Light and system themes are first-class choices.

#### Dark theme

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#0E1013` | main content background |
| `sidebar` | `#15181C` | server rail and navigation |
| `surface` | `#1C2025` | fields, neutral bubbles, call controls |
| `elevated` | `#24292F` | menus and dialogs |
| `hover` | `#2A3037` | hovered or pressed rows |
| `border` | `#31373E` | hairline separation |
| `text-primary` | `#F2F4F7` | primary content |
| `text-secondary` | `#AAB2BD` | previews and supporting labels |
| `text-muted` | `#737D89` | timestamps and disabled text |
| `accent` | `#2AABEE` | primary action and selected state |
| `accent-hover` | `#229ED9` | accent hover and pressed state |
| `success` | `#3BA55D` | presence and completed state |
| `warning` | `#F0B232` | degraded connection and caution |
| `danger` | `#ED4245` | destructive action and hard failure |

#### Light theme

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#FFFFFF` | main content background |
| `sidebar` | `#F4F6F8` | server rail and navigation |
| `surface` | `#FFFFFF` | fields and neutral bubbles |
| `elevated` | `#FFFFFF` | menus and dialogs |
| `hover` | `#E9EEF2` | hovered or pressed rows |
| `border` | `#DDE2E7` | hairline separation |
| `text-primary` | `#17212B` | primary content |
| `text-secondary` | `#5E6B78` | previews and supporting labels |
| `text-muted` | `#87929D` | timestamps and disabled text |
| `accent` | `#2AABEE` | primary action and selected state |
| `accent-hover` | `#229ED9` | accent hover and pressed state |
| `success` | `#2E9650` | presence and completed state |
| `warning` | `#B97A08` | degraded connection and caution |
| `danger` | `#D83C3E` | destructive action and hard failure |

Accent is reserved for primary actions, selection, unread badges, links, the current user's message bubbles, and the active-speaker border. Presence uses success. Warning and danger must not be used decoratively.

User-selected accent presets may change `accent` and derived interaction colors but not semantic success, warning, or danger colors. Presets must meet contrast requirements in both themes.

### Borders and elevation

Layout surfaces use no shadow. Use a 1 px border for structural separation. Menus, popovers, and dialogs may use one elevation token:

```css
box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
```

Do not stack multiple shadow styles or create floating navigation cards.

### Icons

Use one outlined icon family across the product. Icons are 20 px on desktop and 24 dp on Android with a 1.75 to 2 px visual stroke. Filled variants appear only for an active selection when the icon set provides a deliberate pair.

Use conventional symbols: number sign for text channels, speaker for voice channels, paperclip for attachment, microphone for voice notes, phone for voice call, camera for video, monitor for screen sharing, magnifier for search, and cog for settings.

Ambiguous icons require a label, tooltip, or accessible name. Do not mix emoji with interface icons.

### Motion

| Interaction | Duration | Easing |
| --- | ---: | --- |
| Hover and press | 100 ms | ease-out |
| Menu or drawer | 160 ms | ease-out |
| Dialog or viewer | 200 ms | ease-out |
| Reorder settle | 160 ms | ease-out |

There is no bounce, elastic spring, parallax, ambient animation, or animated decoration. Reduced-motion mode removes movement that is not required to understand state and replaces panel transitions with immediate or opacity-only changes.

## Layout

### Desktop shell

- Server rail: 64 px fixed width.
- Context sidebar: 280 px default; 240 px between 768 and 1199 px.
- Content header: 52 px height.
- Information drawer: 320 px, optional.
- Composer horizontal inset: 16 px in direct chats, 16 to 24 px in server channels.
- Message content measure: approximately 720 px for long text while attachments may expand further.

At 1200 px and wider, rail, sidebar, and content remain visible. The optional information drawer can share the viewport. From 768 to 1199 px, the information drawer overlays content. Below 768 px, the application is one pane and navigation uses the drawer.

### Android shell

- Top app bar: 56 dp.
- Navigation drawer: at most 88% of the viewport width.
- Server rail inside drawer: 64 dp.
- Context list occupies the remainder.
- Composer uses at least 52 dp resting height and grows to a bounded multiline height.
- Call control dock respects bottom gesture and display cutout insets.

The Android layout must support a 360 by 800 dp-equivalent viewport without clipped controls and a 412 by 915 viewport without unnecessary whitespace.

## Navigation components

### Server rail

Server icons are 40 px or dp inside a 48 px or dp target. The selected server uses a restrained accent or surface treatment plus a side indicator. Unread servers use a small neutral edge marker. Mention counts use a compact numeric badge.

Do not place server names permanently beside icons. Tooltips on web and accessibility labels on Android provide names.

### Context sidebar

Sidebar rows use 40 to 48 px height. The selected row has one surface fill; it does not use a border, shadow, and accent simultaneously. Unread rows strengthen label contrast. Muted rows reduce label contrast without becoming illegible.

Categories use a 28 to 32 px header with collapse affordance. Category labels are sentence case or the server's chosen casing; the client does not force uppercase.

### Header

The header contains identity on the left and actions on the right. The title is 16 px semibold. Supporting presence or topic text is 12 to 14 px and is omitted when empty. Header actions use compact icon buttons with tooltips.

## Lists and rows

Chat, friend, member, server-setting, and search-result lists use flat rows separated by spacing or hairlines. A row may contain:

- Leading icon or avatar.
- Primary label.
- One line of supporting text.
- Compact trailing metadata.
- One primary inline action when essential.

Rows are not individually elevated. Avoid wrapping every row in a rounded card. Text truncates predictably; primary labels use one line unless the content type explicitly supports wrapping.

## Messaging components

### Direct and group bubbles

- Maximum width: 68% on desktop and 78% on mobile.
- Radius: 16 px, with a subtly tighter corner toward the speaker if desired.
- Horizontal padding: 12 px.
- Vertical padding: 8 px.
- Body text: 16 px or sp.
- Timestamp: 11 to 12 px or sp, aligned without creating a separate footer row when possible.

The current user's bubble uses an accent-tinted surface with verified text contrast. Other bubbles use `surface`. Links use accessible accent treatment. Consecutive messages reduce vertical spacing but retain clear touch targets for actions.

### Server message rows

The first message group uses a 40 px avatar, author name, timestamp, and content. Subsequent messages from the same author within five minutes align to the content column. Hover reveals a compact action bar and the hidden follow-up timestamp. The entire message does not become a card on hover; only a very subtle row fill is allowed.

### Date and unread separators

Separators use a one-pixel rule with a 12 px label. The unread separator may use accent text and line color. It does not float or remain sticky once read.

### Reply reference

Reply references contain a 2 px accent bar, author, and one-line excerpt. Selecting the reference scrolls to and briefly highlights the source. Missing or deleted sources show literal text such as “Original message unavailable.”

### Reactions

Reaction chips are compact, 24 to 28 px tall, with emoji and count. They use a neutral border by default and accent border or tint when selected by the current user. They are actual buttons with selected state exposed to assistive technology.

### Composer

The composer is one structural surface, not a floating nested card. It contains a conventional attachment action, multiline input, emoji action, and conditional send or recording action. Focus uses an accent border or ring without a glow.

Reply, edit, and upload states appear immediately above the input within the same composer region. Each state has a clear cancel action. Upload progress uses filename, percentage or byte progress, and cancel or retry.

### Recording

Recording replaces composer content with elapsed time, waveform, and gesture instruction. The cancel target and locked controls remain reachable with one hand. A red recording indicator conveys capture state but does not pulse when reduced motion is enabled.

## Media

Image and video previews use source aspect ratio within bounded containers. Avoid forced square crops except avatar and album-thumbnail layouts. Loading reserves final dimensions to prevent message-list jumps.

File attachments show file icon or thumbnail, filename, human-readable size, and transfer state. File type is secondary metadata. Download, cancel, retry, and open actions use conventional icons and labels.

Albums contain two to ten media tiles with 2 px gaps and one shared outer radius. A single item is not presented as an album.

Full-screen media viewers use a black or near-black canvas, top controls, optional thumbnail strip, and no decorative framing. Tapping or clicking toggles chrome.

## Menus, dialogs, and sheets

Desktop uses anchored menus for contextual actions, centered dialogs for decisions that require focus, and side drawers for persistent secondary information. Android uses modal bottom sheets for action collections and full-screen or platform dialogs for substantial forms and destructive confirmation.

Menu order must match the task frequency and remain stable. Destructive actions appear last with danger color. A confirmation dialog names the object and consequence; its primary destructive button uses a literal verb such as Delete or Leave.

Dialogs do not include banners, decorative art, or a second explanatory card. A title, concise body, relevant controls, and actions are sufficient.

## Buttons and fields

Button hierarchy:

- Primary: accent fill, one per local decision group.
- Secondary: neutral surface and border.
- Tertiary: text or icon action.
- Danger: danger fill only when confirming destruction; danger text in menus.

Buttons use 6 px radius except compact icon controls that may be circular. Button labels use direct verbs. Disabled buttons reduce contrast and expose disabled semantics; they do not disappear when their absence would shift the layout.

Fields use a visible label for settings and authentication. Conversation search may use a placeholder with an accessible name. Focus uses a 2 px accent ring. Errors appear below the field with danger text and do not rely on color alone.

Toggles represent immediate boolean changes. Radio groups represent one choice among modes. Do not use a toggle for navigation or an irreversible action.

## Calls and screen sharing

### Call grid

Participant tiles use the available area with consistent gaps. Video fills the tile using crop-to-fill by default, with a user-selectable fit option for screen shares. Audio-only participants show avatar and display name. The active speaker uses one accent border; do not add glow, gradient, or scale animation.

Participant status icons appear in a consistent lower corner. Muted, camera-off, and connection-warning states are visible but do not obscure the participant.

### Control dock

The control dock uses one dark neutral surface and fixed action order: Microphone, Camera, Share, Audio route, More, Leave. Controls include labels at larger sizes and accessible labels everywhere. On narrow Android layouts, labels may collapse while order remains stable.

Microphone and camera off states use a clear neutral or danger treatment according to context. Leave is always danger and visually separated from non-destructive controls.

### Compact call bar

While browsing, a compact bar appears at the bottom of the sidebar or drawer. It shows call or channel name, connection state, microphone, and disconnect. Selecting its identity area returns to the call. The bar is not dismissible while the user remains connected.

### Connection state

- Connecting: concise label and bounded progress indicator.
- Connected: no persistent success message.
- Reconnecting: warning label without dismissing participants.
- Degraded: warning icon with details available on selection.
- Failed: plain explanation and Retry or Leave.

Raw telemetry is confined to diagnostics.

### Screen share

The presenter receives a persistent shared-state indicator and Stop sharing action. Viewers see presenter identity and source quality in the viewer controls. Screen-share chrome never overlaps essential source content when controls are hidden.

## Settings design

Desktop settings use a left section list and right content pane. Android uses a full-screen list with nested pages. Search returns exact setting rows and opens their owning page.

Each settings page uses a title followed directly by rows or grouped sections. Group labels are short and literal. Explanations appear beneath values only when they clarify privacy, storage, quality, or platform limitations.

Dangerous account and administration actions occupy a final Danger zone group with explicit consequences. Administration is absent for non-admin users rather than shown disabled.

## Feedback states

### Empty

An empty state contains one conventional icon, one literal sentence, and at most one relevant action. Examples:

- “No messages yet.”
- “No pending friend requests.”
- “No one is connected to this voice channel.”

Do not use mascots, jokes, slogans, or generated illustrations.

### Loading

Use a skeleton only when no cached content exists. Match the geometry of the eventual content. Incremental loading at the top of message history uses a compact progress indicator without moving the current viewport.

### Offline

Keep cached content interactive. A compact persistent banner states “Offline. Messages will send when connected.” Pending messages remain in place. Do not replace the page with an offline illustration.

### Failure

Errors state what failed and offer the next valid action: Retry, Choose another file, Check permission, or Leave call. Technical details are available in diagnostics or log export, not forced into the primary UI.

### Success

Prefer immediate visible state change over toast notifications. Use short toasts only for actions whose result is otherwise invisible, such as copying an invite link.

## Accessibility

- Meet WCAG 2.2 AA contrast for text and meaningful controls.
- Expose names, roles, values, selected state, expanded state, and errors to assistive technology.
- Preserve a logical focus order that matches visual order.
- Restore focus to the invoking control when a menu or dialog closes.
- Provide keyboard operation for all desktop actions.
- Support Escape to close transient layers and conventional arrow-key menu navigation.
- Never rely only on color, sound, hover, or motion to convey state.
- Provide visible focus indicators.
- Respect reduced motion, high contrast, font scaling, and screen-reader settings.
- Provide text alternatives for GIFs, stickers, and media when supplied.
- Announce new-message and call-state changes without interrupting message composition.
- Caption controls must have a reserved location even if server transcription is deferred.

## Responsive and stress states

Every component must be reviewed with:

- Long usernames, server names, channel names, and filenames.
- Mixed English and Russian text.
- Large font scale.
- Hundreds of unread messages.
- Multiple simultaneous uploads.
- Missing avatars and deleted reply sources.
- Offline, reconnecting, rate-limited, and permission-denied state.
- Software keyboard visible in portrait and landscape.
- Split-screen Android layout where supported.
- Reduced motion and higher contrast.

Truncation uses an ellipsis and never removes the only indication of state. Critical actions remain reachable without horizontal scrolling.

## Copy style

Use short, literal sentences and direct verbs. Prefer “Send file,” “Join voice,” “Mute for 1 hour,” and “Delete message.” Avoid enthusiasm, metaphors, and generic reassurance.

Status text describes current state:

- “Connecting...”
- “Reconnecting...”
- “Upload failed. Retry.”
- “Microphone permission is blocked.”

Do not write:

- “Your next conversation starts here.”
- “Make this space uniquely yours.”
- “Oops! Something went wrong.”
- “Unlock the power of connection.”

English and Russian strings must be translation keys rather than embedded component text. Layout must allow common Russian translations to expand without clipping.

## Review checklist

Reject a design or implementation if any answer below is no:

- Is the interaction recognizable from Telegram, Discord, or the host platform?
- Is all visible information relevant to the current task?
- Is the primary action obvious without explanatory prose?
- Is the structure clear without decorative containers?
- Does accent color indicate state or priority rather than decoration?
- Does the screen work with keyboard, touch, and assistive technology?
- Does cached content remain usable while the network changes?
- Are empty, loading, offline, failure, and reconnect states designed?
- Does it work at 1440 and 1024 px desktop widths?
- Does it work at 412 by 915 and 360 by 800 Android viewports?
- Are all common actions reachable through conventional UI?
- Is advanced complexity hidden until requested but still discoverable?

If a proposed element cannot be justified by user state, task completion, content hierarchy, safety, or platform convention, remove it.
