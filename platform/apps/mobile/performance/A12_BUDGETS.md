# Samsung A12 performance budgets

Target device: Samsung Galaxy A12-class hardware, Android 10–12, 4 GB RAM, release APK, baseline profile installed, battery saver disabled.

| Journey | Budget |
| --- | ---: |
| Warm tab response | 17 ms JS response |
| Warm cached chat open | 150 ms |
| Cold cached chat open | 350 ms |
| Attachment drawer first usable frame | 400 ms |
| Image/video viewer first usable frame | 450 ms |
| One 1 MiB upload chunk on local Wi-Fi | 2.5 s |
| Message or attachment scrolling | p95 frame ≤ 32 ms; missed-frame rate < 5% |
| Cold startup with baseline profile | time-to-initial-display ≤ 1.8 s |

Run the instrumentation against a signed-in physical A12:

```powershell
cd platform/apps/mobile/android
./gradlew :app:assembleRelease :macrobenchmark:connectedBenchmarkAndroidTest
```

The `StartupBenchmarks` suite measures cold startup, inbox-to-chat, message scrolling, and attachment-drawer scrolling. Runtime upload, navigation, and media timings are also retained in the app's redacted diagnostics report. Regressions over these budgets should block a release unless a trace identifies network latency rather than device work.
