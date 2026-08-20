# Architecture exceptions

Architecture exceptions are temporary, reviewed debt. They may not grow and
they do not authorize new code to copy the same pattern.

## Dormant server administration routes

- Path: `apps/api/src/modules/servers/routes.ts`
- Reason: the Servers product is intentionally hidden while its historical API
  remains available for future migration and data compatibility.
- Maximum size: the line count present when the architecture gate was added.
- Removal gate: before Servers can return to mobile bootstrap or navigation,
  split the module by membership, channels, roles, moderation, and audit use
  cases; add runtime capability and compatibility tests; remove this exception.
- Owner: Snezhok platform maintainer.

`apps/mobile/src/i18n.ts` is not an exception: localized copy is explicitly
excluded from the module-size rule in `ENGINEERING_GUIDELINES.md`.
