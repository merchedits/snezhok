# Snezhok preview application

This wrapper builds the Telegram-derived UI under the isolated application ID
`xyz.merchedits.snezhok.preview`. It intentionally uses Android's debug signing
key and cannot replace either official Telegram or the stable Snezhok APK.

Build on Windows:

```powershell
.\gradlew.bat :SnezhokPreviewApp:assembleDebug "-PSNEZHOK_PREVIEW_ABIS=armeabi-v7a,arm64-v8a"
```

The module must remain free of Telegram API credentials, Firebase projects,
deep-link handlers and production signing material. It is a migration shell,
not a releasable client, until the gates in `docs/PORTING_PLAN.md` are complete.
