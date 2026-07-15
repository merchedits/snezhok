# Dependency and license audit

This document is an engineering inventory, not legal advice. A dependency may
not enter a distributed Snezhok APK until its license, notices, source
obligations and compatibility have been reviewed.

| Component | License/status | Snezhok decision |
| --- | --- | --- |
| Telegram Android source | GPL-2.0 | Foundation and retained UI implementation; preserve history, notices and complete corresponding source. |
| AndroidX libraries | Apache-2.0 | Inherited upstream dependencies; retain notices and audit the exact resolved graph. |
| Google/Firebase libraries | Mixed/proprietary SDK terms | Remove everything not required by Snezhok. Push delivery is designed separately and never depends on Telegram credentials. |
| Telegram native media/VoIP code | Mixed vendored sources | Audit file-by-file before retention; Telegram server-specific call code is not a Snezhok call solution. |
| LiveKit Android SDK | Apache-2.0; not yet added | **Blocked pending GPLv2 compatibility review.** Do not copy the React Native integration into this client. |
| Snezhok API contracts | Snezhok original | Publish the client-facing schemas needed to build the app; backend implementation and secrets remain separate. |

## Required automated outputs

- Gradle dependency lock or verification metadata.
- Resolved dependency/SBOM report for every release variant.
- Packaged license and notice screen available from Settings.
- CI failure when a dependency has no recorded license decision.

## LiveKit decision gate

Before calls are implemented, choose one documented path:

1. obtain qualified confirmation that the selected integration and
   distribution model is compatible;
2. obtain an additional permission/exception where required; or
3. select a GPL-compatible call implementation.

Calls remain outside the native release until this gate is resolved. The
production React Native client continues to provide calls during the port.
