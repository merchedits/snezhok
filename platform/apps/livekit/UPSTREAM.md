# LiveKit runtime provenance

Snezhok builds its LiveKit server from the official Apache-2.0 source rather
than relying on a prebuilt container whose bundled Go dependencies cannot be
updated independently.

- Upstream: <https://github.com/livekit/livekit>
- Release: `v1.13.5`
- Source commit: `3b9f118327b257301083a7c4aa46076c8012918a`
- Toolchain: Go `1.26.6`
- Dependency override: `golang.org/x/mod v0.40.0`

The source commit is checked after checkout and recorded in the produced
binary by Go build metadata. The toolchain and dependency override contain
security fixes that were not present in the upstream prebuilt `v1.13.5`
container. No LiveKit application source is modified. The upstream `LICENSE`
and `NOTICE` files are retained in the runtime image under `/licenses/livekit`.

When updating LiveKit, review the official release, pin the exact source
commit and base-image manifest digests, rebuild the SBOM, run the strict
container vulnerability gate, and physically validate a two-device call over
independent networks.
