# Provenance

## Upstream

- Project: Telegram for Android
- Repository: <https://github.com/DrKLO/Telegram>
- Snezhok fork: <https://github.com/merchedits/snezhok>
- Foundation commit: `9b50143d` (`update to 12.8.1 (6916)`)
- License: GNU GPL version 2

The Git fork relationship and upstream history must be preserved. Upstream is
configured locally as the `upstream` remote. Upstream updates are reviewed and
merged deliberately; they are never force-pushed over Snezhok release tags.

## Change provenance

Every file copied from another project must keep its original copyright and
license notice. New third-party code requires an entry in
`docs/DEPENDENCY_LICENSES.md` before it is included in a distributed APK.

Snezhok-specific commits should explain whether they:

1. retain and adapt upstream Telegram behavior;
2. replace Telegram-specific transport or storage code;
3. introduce original Snezhok code; or
4. incorporate another third-party component.

The source tag named in an APK's release manifest is the complete corresponding
source for that APK.
