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

Run the fail-closed instrumentation against a signed-in physical SM-A125F from
`platform/`:

```powershell
npm run release:verify-android-physical
```

The runner rejects emulators, ambiguous devices, a dirty `platform/` subtree,
missing journeys, cold startup above 1.8 seconds, frame P95 above 32 ms, and a
missed-frame rate of 5% or more. The instrumentation separately enforces the
150/350 ms warm/cold cached-chat and 400 ms attachment-drawer interaction
budgets. Results and Perfetto traces are copied to
`runtime/evidence/android/<revision>/<timestamp>/` with a privacy-safe manifest
and hashes. Runtime upload, navigation, and media timings are also retained in
the app's redacted diagnostics report.
