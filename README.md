# Snezhok for Android

Snezhok is a private messaging, file-sharing, voice and video client for the
Snezhok service. This repository is the native Android successor to the current
React Native client.

The project is derived from the official
[Telegram Android](https://github.com/DrKLO/Telegram) source so that mature
message-list, media, accessibility and low-end-device techniques can be retained
instead of recreated. Snezhok is independent from Telegram, is not endorsed by
Telegram, does not use the Telegram name or logo, and will connect only to the
Snezhok service.

## Current status

The `master` history is the preserved upstream Telegram history. Active Snezhok
work starts on `codex/snezhok-foundation`.

This branch is an engineering foundation, not a distributable Snezhok build.
The inherited MTProto domain and Telegram credentials must be removed before
the application can use Snezhok's production package ID or signing key. Until
the native parity gates pass, the existing Snezhok Android application remains
the production client.

See:

- [Porting plan](docs/PORTING_PLAN.md)
- [Dependency and licensing audit](docs/DEPENDENCY_LICENSES.md)
- [Release and source policy](docs/RELEASE_POLICY.md)
- [Provenance](docs/PROVENANCE.md)

## License

This derivative is distributed under GNU GPL version 2, consistent with its
upstream. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Individual third-party
components retain their own notices and licenses.

No production credentials, signing keys, user data, server secrets or private
deployment configuration belong in this repository.
