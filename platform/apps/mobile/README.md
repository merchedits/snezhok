# Snezhok for Android

This is the first-party Android client for the clean-slate Snezhok platform. It is an Expo CNG application that ships through a custom development client and signed APK; it does not run in Expo Go because LiveKit and WebRTC require native code.

## Product shape

- Telegram-style flat chat list and direct/group message bubbles
- Dedicated Servers screen with a horizontal server picker and flat channel list
- Bottom navigation for Chats, Servers, Profile, and Settings, plus native Android Back in detail screens
- Cached bootstrap and recent messages, optimistic sends, and a durable text outbox
- Resumable chunk uploads with Auto, High, Data saver, and Original quality modes
- Photo/video/file attachments, voice recording, and video-note capture
- LiveKit SFU calls with communication audio, adaptive video, camera, device screen share, and audio-route selection
- Secure access/refresh tokens stored with Android Keystore-backed SecureStore
- Russian-first interface with English available in Settings
- Public email, username, and password registration without invitations

The app imports domain types from `@snezhok/contracts`. REST calls are isolated in `src/lib/api.ts`; durable local state is isolated behind `src/lib/offlineRepository.ts` so a SQLite-backed repository can replace AsyncStorage without changing screens.

## Development

From `platform/`:

```powershell
npm install
npm run typecheck --workspace=@snezhok/mobile
npm exec --workspace=@snezhok/mobile -- expo start --dev-client
```

Set `EXPO_PUBLIC_API_URL` when the API is not at `https://merchedits.xyz/chat/api/v1`. Rebuild the development client after changing native dependencies or `app.config.ts`.

See [ANDROID_BUILD.md](./ANDROID_BUILD.md) for signed APK instructions and native prerequisites.
