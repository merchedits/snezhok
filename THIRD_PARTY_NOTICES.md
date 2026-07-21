# Third-party notices

Snezhok is licensed under `GPL-3.0-or-later`. Corresponding source for a
distributed build is the tagged revision in
[merchedits/snezhok](https://github.com/merchedits/snezhok), including the
native modules and build scripts required to produce it.

The application depends on third-party packages whose copyright and license
terms remain with their respective authors. `platform/package-lock.json` locks
the npm graph. Android release builds additionally resolve a Gradle/Maven graph
that is recorded in `android-dependencies.json` and an Android CycloneDX file.
The generated inventories, publisher declarations and reviewed overrides are
traceability evidence for the particular build; they are not legal advice,
legal conclusions, or a substitute for reviewing the corresponding source and
license terms. A release must preserve discoverable LICENSE/NOTICE files from
resolved Android artifacts and distribute the generated evidence beside and
inside the APK.

The UI follows interaction patterns familiar from Telegram and Discord, but
their names, logos, artwork and trademarks are not part of Snezhok. No upstream
Telegram source file is currently vendored in this repository. If GPL-covered
upstream code is introduced later, its source path, upstream revision, local
modifications and copyright notice must be listed here in the same commit.

The snowflake name and artwork identify Snezhok only and do not imply
affiliation with Telegram FZ-LLC or Discord Inc.
