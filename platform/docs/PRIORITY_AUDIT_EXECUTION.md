# Priority audit execution ledger

This is the implementation ledger for the approved Priority 0, Priority 1, and
risk-register batch. “Resolved” means the repository owns the behavior.
“Gated” means the safe resolution is an explicit product/release boundary,
not an unvalidated feature claim. Physical confirmation lives in
`CURRENT_VALIDATION_STATUS.md`.

## Priority 0

| Audit item | State | Outcome |
| --- | --- | --- |
| Bottom anchor and delayed tap | Resolved | FlashList owns anchoring; the competing initial scroll and 280 ms reaction delay are removed. |
| Optimistic nonblocking attachments | Resolved | Durable acknowledgement closes the picker; caption/local media and preparing/uploading/processing/retrying/failed/cancelled/sent states are retained. |
| Offline/process-safe queue | Resolved | WorkManager plus stable capability/client IDs survive interruption; cancel/retry is bubble-local and owner-scoped. |
| Mixed viewer and downloads | Resolved | Image/video pager preserves position; documents expose persistent progress, cancel, retry, open/share; selection downloads attachments. |
| Two-account/device failure matrices | Evidence open | Exact attachment/messaging matrix is mandatory in `CURRENT_VALIDATION_STATUS.md`; no physical result is fabricated. |
| Expo/Skia mismatch | Resolved | Expo packages align; tested Skia pin and replacement criteria have an ADR. |
| Baseline profile/performance | Evidence open | Macrobenchmark/profile workflow exists; profile remains absent until generated on the A12. |
| Regex confidence | Improved | New interaction, formatting, link, account, call, and transfer behavior uses domain/integration tests. Remaining source guards are not runtime evidence. |
| Web/game architecture and component size | Resolved | Executable gate covers API/mobile/web/contracts/game engine, ownership, and source ceilings. |
| Localization/dynamic type/360x800 | Improved/open | New Android strings are bilingual and principal controls scale/wrap; exact screen/font matrix remains physical evidence. Web localization debt is explicit. |
| Freeze new games | Gated | No new game or broad novelty feature until messaging, attachment, and call physical matrices are green. |

## Priority 1

| Audit area | State | Outcome |
| --- | --- | --- |
| Global/indexed search | Resolved | Conversations, people, messages, attachments and jump UI share search; PostgreSQL trigram indexes fail closed in production and only degrade under PGlite. |
| Folders/archive/filters | Resolved | Chat list exposes create/manage folders, archive and filters. |
| Rich text and previews | Resolved | Bounded bold/italic/mono/quote/HTTPS rendering and formatting. Preview fetch rejects credentials, redirects, non-443 ports, non-public DNS and rebinding; time/size/cache/rate are bounded. |
| GIF/stickers; polls/contact/location | Gated | Held by the feature freeze until core matrices are green and a real need justifies new contracts, permissions, privacy and abuse surface. |
| Multi-select | Resolved | Copy, forward, delete and save/download are available. |
| Reactions/albums/editing | Improved/gated | Counts/details/direct interaction, captions and deterministic ten-item groups are present. Destructive pre-send crop/rotate/reorder waits for validated native UX so originals and durable staging cannot be corrupted. |
| Transfer transparency | Resolved | Type/size/quality, progress/processing, cancellation and retry are visible. |
| Voice | Improved/gated | Cross-chat playback coordination, UI-thread gestures and bounded meter logic exist. Transcription waits on consent/privacy/model/cost; Samsung recording needs physical/native evidence. |
| Calls | Improved/open | Durable history, avatars, reconnect/network quality, camera failure/retry, self-view/PiP, notification actions and foreground services exist. Independent-network/lock-screen/ConnectionService claims remain open. |
| Notifications | Resolved | Message reply/read/mute and exact-ID call answer/decline are wired. |
| Sessions/app lock/multi-account | Resolved/open | Device sessions, opt-in strong biometric resume lock and a five-account SecureStore vault exist. Caches, transfers and late work are owner-scoped; physical switching remains open. |
| Username/QR/deep links | Partial/gated | Username and verified HTTPS/custom-scheme routes exist. QR waits for final public-share and enumeration policy. |
| Accessibility/APK size | Improved/open | Dynamic sizing/wrapping plus small-screen matrix. Minification/resource shrinking and AAB splits are enabled; compatible direct APK remains dual-ABI and size-gated. |

## Risk register disposition

| Risk | Disposition |
| --- | --- |
| No Android-green evidence | Open and visible; exact physical matrices cannot be satisfied locally. |
| Blocking attachments/competing scroll | Code-resolved; physical matrix open. |
| No E2EE | Truthfully disclosed; future migration bounded by the E2EE ADR. |
| Expo/Skia mismatch | Resolved by alignment and tested pin. |
| No independent-network calls | Open physical release gate; never inferred from signaling. |
| Local object storage/process-local presence | Contained: production rejects `DEPLOYMENT_REPLICAS != 1` until shared objects and cross-node Socket.IO exist. |
| Broad substring search | Resolved with indexes and bounded result classes. |
| Broad product surface | Contained by dormant servers and feature freeze. |
| Large contexts/screens | Architecture ceilings enforced; web reconciliation/outbox logic extracted. |
| Architecture omitted web/game | Resolved in executable gate. |
| Regex-only tests | Reduced; new core behavior is executable. Static guards cannot prove runtime behavior. |
| Plain local caches | Disclosed/no-backup. App lock reduces resume exposure but is not local encryption or E2EE. |
| Direct APK/universal size | Signed hash/range/atomic controls remain; dual ABI preserves compatibility, AAB splits store delivery, and stable size is measured. |
| JS voice recording | Native/performance evidence gate retained; no unsupported claim. |
| Web monolith/docs drift | Domain extraction and architecture scanning reduce drift; web remains secondary and follows Android contracts. |
| Dependency advisories | Contained to Android-inactive Expo/Xcode tooling with no use of the vulnerable UUID APIs; the offered Expo 46 downgrade is forbidden. |
| Backup/deployment concentration | Encrypted off-host backups, restores, least privilege and single-replica guard remain mandatory. |
| Accessibility | New controls scale/wrap; exact 360x800/large-font evidence remains open. |

## Product gate

Until open physical matrices are recorded, prioritize defects in messaging,
attachments, calls, search, accessibility, updates, and performance. Do not add
a new game, sticker/GIF system, poll/location/contact contract, transcription
pipeline, or similarly broad surface merely to increase feature count.
