# Keep the validated newer Skia runtime on Expo 56

- Status: Accepted
- Date: 2026-08-30
- Owner: Snezhok engineering
- Supersedes: none

## Context and outcome

Expo SDK 56 declares React Native Skia 2.6.2, while Snezhok pool playback uses
2.11.1. Expo Doctor therefore reports a mismatch. Blindly downgrading would
replace a runtime used by the current pool renderer without device evidence.

## Evidence

- Existing implementation/history: pool playback uses one always-mounted Skia
  canvas and Reanimated values; engine and presentation regression tests pass.
- Authoritative guidance: Expo's bundled module manifest declares 2.6.2 and
  Expo Install supports explicit validation exclusions for intentionally chosen
  versions.
- Open-source/native candidates: Skia 2.11.1 declares peers compatible with
  React 19, React Native 0.85, Reanimated 4, and Worklets 0.8. Skia's tracker
  also contains Expo 56 regressions reported against 2.6.2, so the declared
  Expo version is not automatically the lower-risk choice.

## Options

| Option | Correctness and UX | Performance and compatibility | Maintenance, license, and risk |
| --- | --- | --- | --- |
| Keep 2.11.1 and declare the exception | Preserves current renderer | Peer ranges match the installed runtime | Requires explicit pool/device validation |
| Downgrade to 2.6.2 | Satisfies Expo Doctor by default | Known upstream Expo 56 issues; pool unverified | High regression risk |
| Replace Skia renderer | Reopens recently stabilized pool work | Unknown | Highest cost and risk |

## Decision

Keep 2.11.1, document the compatibility evidence, and exclude only this package
from Expo's version validator. Continue aligning all Expo-owned packages to the
SDK 56 patch set. The exception must be reconsidered during the next Expo SDK
upgrade or if native crash evidence implicates Skia.

## Consequences and rollback

Expo Doctor no longer treats this intentional choice as dependency drift. A
rollback is a single dependency pin, but it requires a signed candidate and the
pool shot/device matrix before promotion.

## Validation

- Focused local checks: mobile typecheck, pool engine and presentation tests,
  Expo dependency check.
- Tester-candidate scenarios: maximum-power shot, collision, cushion rebound,
  repeated modal open/close, background/foreground.
- Stable-release evidence: signed APK provenance and crash-free tester soak.
- Physical-device evidence still required: Samsung SM-A125F and one
  representative modern Android device.
