# Cozy Chat — Design System

> Soft, warm, and comfortable. Every pixel should feel like a Sunday morning.

---

## 1. Design Philosophy

**Comfort is the product.** This is not a productivity tool. It is a place where friends gather. The design should evoke the feeling of a cozy apartment — warm lighting, soft textures, familiar and predictable.

### Three words that guide every decision
- **Soft** — nothing harsh, sharp, or loud
- **Warm** — color temperature leans warm-neutral
- **Alive** — subtle motion makes it feel inhabited, not static

### Anti-patterns to avoid
- Hard black (`#000`) anywhere in the UI
- Pure white backgrounds (too clinical)
- High-contrast, bold borders
- Busy gradients or glassmorphism
- Uppercase labels (except keyboard shortcuts)
- System fonts (they feel cold)

---

## 2. Color Palette

All colors use CSS custom properties. Never hardcode hex values in components — always reference a token.

### Base surfaces

| Token | Value | Use |
|---|---|---|
| `--color-bg-base` | `#F5F0EB` | App background (warm off-white) |
| `--color-bg-surface` | `#FDFAF7` | Cards, panels, message bubbles |
| `--color-bg-elevated` | `#FFFFFF` | Modals, dropdowns, tooltips |
| `--color-bg-subtle` | `#EDE8E3` | Sidebar, hover states, input fill |
| `--color-bg-overlay` | `rgba(60, 45, 35, 0.4)` | Modal backdrop |

### Brand palette (Pastel)

| Token | Value | Name | Use |
|---|---|---|---|
| `--color-peach` | `#FFCFB3` | Peach | Primary accent, active states |
| `--color-peach-dark` | `#E8A882` | Peach Dark | Hover on peach elements |
| `--color-peach-soft` | `#FFF0E8` | Peach Soft | Peach tinted backgrounds |
| `--color-sage` | `#B5CDB5` | Sage | Online indicator, success |
| `--color-sage-soft` | `#E8F2E8` | Sage Soft | Success backgrounds |
| `--color-lavender` | `#C5B8E8` | Lavender | Voice call active, info |
| `--color-lavender-soft` | `#EDE8F8` | Lavender Soft | Lavender tinted backgrounds |
| `--color-rose` | `#F2B8C6` | Rose | Notifications, mentions |
| `--color-butter` | `#F5E6A3` | Butter | Reactions, highlights |

### Text

| Token | Value | Use |
|---|---|---|
| `--color-text-primary` | `#3D2E24` | Body text, headings |
| `--color-text-secondary` | `#7A6558` | Timestamps, labels, placeholders |
| `--color-text-tertiary` | `#A8978C` | Disabled, muted metadata |
| `--color-text-inverse` | `#FDFAF7` | Text on dark/colored surfaces |

### Semantic

| Token | Value | Use |
|---|---|---|
| `--color-online` | `#8FC98F` | Online presence dot |
| `--color-offline` | `#C2B5AB` | Offline presence dot |
| `--color-destructive` | `#E8927A` | Errors, delete actions |
| `--color-voice-active` | `#C5B8E8` | Voice call ring, mic active |

### Dark Mode

All tokens shift in dark mode. The warm palette inverts to a deep warm-dark:

| Token (dark) | Value |
|---|---|
| `--color-bg-base` | `#1E1812` |
| `--color-bg-surface` | `#2A2018` |
| `--color-bg-elevated` | `#352820` |
| `--color-bg-subtle` | `#3D2E24` |
| `--color-text-primary` | `#F0E8E0` |
| `--color-text-secondary` | `#B8A89A` |
| `--color-text-tertiary` | `#7A6558` |

Use `@media (prefers-color-scheme: dark)` + `[data-theme="dark"]` selector.

---

## 3. Typography

### Font Stack

```css
--font-display: 'Nunito', 'Quicksand', system-ui, sans-serif;
--font-body:    'DM Sans', 'Nunito', system-ui, sans-serif;
--font-mono:    'DM Mono', 'Fira Code', monospace;
```

**Nunito** for display — rounded letterforms, friendly, soft. Load weights 400, 600, 700.
**DM Sans** for body — warm, readable, slightly rounded. Load weights 400, 500.
**DM Mono** for code blocks and timestamps — unobtrusive monospace.

All fonts must be bundled locally (download from Google Fonts, serve from `/public/fonts/`). No runtime Google Fonts requests.

### Type Scale

| Token | Size | Weight | Line Height | Use |
|---|---|---|---|---|
| `--text-xs` | 11px | 400 | 1.4 | Metadata, timestamps, badges |
| `--text-sm` | 13px | 400 | 1.5 | Secondary labels, captions |
| `--text-base` | 15px | 400 | 1.65 | Message body, default UI text |
| `--text-md` | 17px | 500 | 1.5 | Usernames, section labels |
| `--text-lg` | 20px | 600 | 1.3 | Modal titles, page headings |
| `--text-xl` | 26px | 700 | 1.2 | App name, large callouts |

Letter spacing: `-0.01em` on sizes ≥ 17px. Never use `text-transform: uppercase` on body copy.

### Message text rules
- Default message: `--text-base`, `--color-text-primary`
- Own messages: same size, slightly warmer surface background
- System messages (joined, left): `--text-sm`, `--color-text-tertiary`, centered
- Code in messages: `--font-mono`, `--text-sm`, on `--color-bg-subtle` background, `4px` padding, `6px` border-radius

---

## 4. Spacing & Grid

### Base unit
`4px`. All spacing values are multiples of 4.

### Spacing scale

| Token | Value | Common use |
|---|---|---|
| `--space-1` | 4px | Inline gaps, icon padding |
| `--space-2` | 8px | Tight component padding |
| `--space-3` | 12px | Button padding, list item gaps |
| `--space-4` | 16px | Component internal padding |
| `--space-5` | 20px | Section gaps within a panel |
| `--space-6` | 24px | Between major sections |
| `--space-8` | 32px | Panel-level margins |
| `--space-10` | 40px | Page-level breathing room |
| `--space-12` | 48px | Large separators |

### App layout grid

The app is a fixed three-column layout (desktop):

```
┌────────────┬──────────────────────────┬──────────────┐
│  Sidebar   │       Main Chat          │ Member Panel │
│  64px      │       flex: 1            │  240px       │
│  (icons)   │                          │  (optional)  │
└────────────┴──────────────────────────┴──────────────┘
```

- **Sidebar** (icon rail): `64px` fixed, `--color-bg-subtle` background
- **Main chat**: flexible, min `480px`
- **Member panel**: `240px`, collapsible on smaller screens
- On screens < `768px`: sidebar collapses to bottom nav, member panel hides

### Chat area internal grid

```
┌─────────────────────────────────────┐
│  Chat header         16px padding   │
├─────────────────────────────────────┤
│  Message list        padding: 16px  │  ← scrollable
│  (bottom-anchored)   msg gap: 4px   │
│                      group gap: 16px│
├─────────────────────────────────────┤
│  Input area          12px padding   │
└─────────────────────────────────────┘
```

Message grouping: messages from the same user within 5 minutes are grouped. Only the first message in a group shows the avatar + username. Subsequent messages in the group show no avatar (replaced by time on hover).

---

## 5. Components

### Avatars

- **Shape**: Circle
- **Sizes**: 24px (inline), 32px (message list), 40px (member panel), 56px (profile)
- **Fallback**: Two-letter initials on a pastel background (pick from palette based on username hash)
- **Border**: `2px solid var(--color-bg-surface)` — creates separation from background

Online indicator: `10px` circle, `--color-online` fill, `2px` white border, bottom-right of avatar.

### Message bubbles

Own messages:
- Background: `--color-peach-soft`
- Border: none
- Border-radius: `16px 16px 4px 16px` (sharp bottom-right = "tail" effect)
- Align: right
- Max-width: `72%`

Others' messages:
- Background: `--color-bg-surface`
- Border: `1px solid --color-bg-subtle`
- Border-radius: `16px 16px 16px 4px` (sharp bottom-left)
- Align: left
- Max-width: `72%`

Padding inside bubble: `10px 14px`

### Buttons

| Variant | Background | Text | Border | Use |
|---|---|---|---|---|
| Primary | `--color-peach` | `--color-text-primary` | none | Send, confirm |
| Ghost | transparent | `--color-text-secondary` | `1px solid --color-bg-subtle` | Secondary actions |
| Danger | `--color-destructive` (10% opacity) | `--color-destructive` | none | Delete, leave |
| Icon | transparent | `--color-text-secondary` | none | Toolbar icons |

All buttons:
- Border-radius: `10px` (or `50%` for icon-only round buttons)
- Height: `36px` (default), `32px` (compact), `44px` (primary CTA)
- Transition: `background 150ms ease, transform 100ms ease`
- Active state: `transform: scale(0.97)`
- Focus: `outline: 2px solid var(--color-peach)`, `outline-offset: 2px`

### Input fields

- Background: `--color-bg-subtle`
- Border: `1.5px solid transparent`
- Border-radius: `12px`
- Padding: `10px 14px`
- Font: `--text-base`
- Focus: border becomes `1.5px solid var(--color-peach)`
- Transition: `border-color 150ms ease`
- Placeholder: `--color-text-tertiary`

### Message input area

- Multi-line textarea (auto-grows, max 6 lines)
- Attach file button (left side, icon)
- Emoji button (left side, icon)
- Send button (right side, round, `--color-peach`)
- Background: `--color-bg-surface`
- Top border: `1px solid var(--color-bg-subtle)`
- Padding: `12px 16px`

### Voice call UI

Active call banner:
- Appears at top of chat area
- Background: `--color-lavender-soft`
- Border-bottom: `1px solid --color-lavender` (20% opacity)
- Height: `52px`
- Shows: pulsing mic icon, caller names, mute/end buttons
- Pulsing ring animation on active speaker: `box-shadow` pulse using `--color-lavender`

### Presence dots

| State | Color | Animation |
|---|---|---|
| Online | `--color-online` | none |
| Speaking (voice) | `--color-lavender` | `scale` pulse 1.2x, 800ms loop |
| Offline | `--color-offline` | none |

---

## 6. Iconography

Use **Lucide React** exclusively. Icon sizes:

| Context | Size |
|---|---|
| Inline with text | 14px |
| Toolbar / action icons | 18px |
| Navigation sidebar | 22px |
| Large empty states | 48px |

Stroke width: `1.75px` (Lucide default is `2px` — reduce to `1.75px` for a softer feel).
Color: inherit from parent text color.

Preferred icons:
- Chat: `MessageCircle`
- Voice: `Phone`, `Mic`, `MicOff`, `PhoneOff`
- Attach: `Paperclip`
- Emoji: `Smile`
- Send: `Send`
- Members: `Users`
- Settings: `Settings`
- Online: `Circle` (filled via CSS)
- Close: `X`
- File: `FileText`, `Image`, `Film`

---

## 7. Motion & Animation

Keep it gentle. Nothing should feel jarring or draw too much attention.

### Easing functions

```css
--ease-out:   cubic-bezier(0.0, 0.0, 0.2, 1);   /* Elements entering */
--ease-in:    cubic-bezier(0.4, 0.0, 1, 1);       /* Elements leaving */
--ease-soft:  cubic-bezier(0.34, 1.04, 0.64, 1);  /* Spring-like, bouncy */
```

### Duration scale

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 100ms | Hover states, micro-feedback |
| `--dur-base` | 200ms | Default transitions |
| `--dur-slow` | 350ms | Panels sliding, modals |

### Key animations

**New message appears:**
- `translateY(6px) → translateY(0)` + `opacity: 0 → 1`
- Duration: 200ms, `--ease-out`

**Message sent (own):**
- Brief `scale(0.97) → scale(1)` on the bubble
- Duration: 150ms

**Panel slide (member list):**
- `translateX(240px) → translateX(0)`
- Duration: 350ms, `--ease-soft`

**Voice call pulse (active speaker):**
- `box-shadow: 0 0 0 0 rgba(197,184,232,0.6) → 0 0 0 8px rgba(197,184,232,0)`
- Duration: 800ms, `ease-out`, infinite

**Presence dot (online → speaking):**
- Color transition + scale pulse
- Duration: 300ms

### Rules
- Respect `prefers-reduced-motion`. Wrap all non-essential animations in `@media (prefers-reduced-motion: no-preference)`.
- Never animate `width` or `height` — use `transform` instead.
- Message list scroll to new message: `scrollIntoView({ behavior: 'smooth' })`, but only if user was already at the bottom. If they've scrolled up, show a "new message" badge instead.

---

## 8. Responsive Breakpoints

| Name | Width | Layout |
|---|---|---|
| Mobile | < 640px | Single column, bottom navigation |
| Tablet | 640px–1024px | Sidebar icon rail visible, member panel hidden |
| Desktop | > 1024px | Full three-column layout |

The app is primarily designed for desktop but must be fully functional on mobile.

---

## 9. Empty States & Loading

### Empty chat (first time)
- Centered illustration (simple SVG, warm palette)
- Heading: "Say hello 👋"
- Subtext: "You're the first one here. Send a message to get the conversation going."

### Loading skeleton
- Pulse animation on gray rectangles mimicking message bubbles
- Background: `--color-bg-subtle`, opacity 60%→100% loop, 1.2s

### Connection lost
- Slim banner at top of viewport
- Background: `--color-destructive` at 15% opacity
- Text: "Reconnecting..." with a spinning icon
- Auto-dismisses when reconnected

---

## 10. File Sharing UI

### In-chat file previews

| File type | Preview |
|---|---|
| Image (jpg/png/gif/webp) | Thumbnail, max 320px wide, click to full view |
| Video (mp4/webm) | Inline player, poster frame, max 320px wide |
| Audio (mp3/ogg) | Compact audio player bar |
| PDF / document | File card: icon + filename + size + download button |
| Other | File card: generic icon + filename + size + download button |

File card style:
- Background: `--color-bg-subtle`
- Border-radius: `12px`
- Padding: `10px 14px`
- Icon: Lucide, 20px, `--color-text-secondary`
- Filename: `--text-sm`, `--color-text-primary`, truncated with ellipsis
- Size: `--text-xs`, `--color-text-tertiary`
- Download button: icon-only, right side

---

## 11. Accessibility

- All interactive elements must have visible focus rings
- Color must not be the only indicator (presence = dot shape + color + tooltip)
- Minimum touch target: 44×44px on mobile
- Images in chat: alt text from filename
- Voice call controls: labeled with aria-label
- Use semantic HTML: `<main>`, `<nav>`, `<aside>`, `<button>`, `<article>` for messages
- Screen reader: announce new messages via `aria-live="polite"` region
