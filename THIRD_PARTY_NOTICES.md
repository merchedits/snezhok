# Third-party notices

Snezhok is licensed under `GPL-3.0-or-later`. Corresponding source for a
distributed build is the tagged revision in
[merchedits/snezhok](https://github.com/merchedits/snezhok), including the
native modules and build scripts required to produce it.

The application depends on third-party packages whose copyright and license
terms remain with their respective authors. The exact dependency graph and
declared package licenses are recorded by `platform/package-lock.json`; release
builds must be produced from that lockfile. A release must not remove license
files embedded by Android libraries or npm packages.

The UI follows interaction patterns familiar from Telegram and Discord, but
their names, logos, artwork and trademarks are not part of Snezhok. No upstream
Telegram source file is currently vendored in this repository. If GPL-covered
upstream code is introduced later, its source path, upstream revision, local
modifications and copyright notice must be listed here in the same commit.

The snowflake name and artwork identify Snezhok only and do not imply
affiliation with Telegram FZ-LLC or Discord Inc.
