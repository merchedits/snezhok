# Android release and source policy

Every distributed GPL-derived APK has one immutable source tag. A release is
incomplete unless recipients can obtain the exact preferred source for
modification, build instructions and relevant scripts from the same release
page or an equally prominent source link.

## Release contents

- signed APK and checksum;
- source tag and source archive;
- upstream base commit and Snezhok commit;
- application ID, version name/code, min/target SDK and architectures;
- dependency lock/verification data and license report;
- reproducible build instructions and toolchain versions;
- user-facing release notes and migration/rollback notes.

The app exposes **Settings → About → Source code and licenses**. The source URL
is also present in the update manifest.

## Secrets

The release keystore, passwords, API/session secrets, production database and
user data are never published. GPL source availability does not require
publishing private signing keys. CI receives signing material only through a
protected release environment.

## Package identity gate

Preview builds use a distinct package and debug signing identity. The native
client may adopt `xyz.merchedits.snezhok` only after it can import or safely
invalidate the current client's session/cache, pass the parity checklist, and
install as an upgrade signed by the existing Snezhok certificate.
