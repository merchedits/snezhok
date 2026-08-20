FROM golang:1.26.6-alpine@sha256:3889b425f035be855a72fb4755265311293b6d414521f0a519d819df32222d83 AS build

ARG TARGETARCH
ARG LIVEKIT_REVISION=3b9f118327b257301083a7c4aa46076c8012918a

RUN apk add --no-cache ca-certificates git

WORKDIR /src

RUN git clone --filter=blob:none --no-checkout https://github.com/livekit/livekit.git . \
  && git checkout --detach "$LIVEKIT_REVISION" \
  && test "$(git rev-parse HEAD)" = "$LIVEKIT_REVISION" \
  && go mod edit -require=golang.org/x/mod@v0.40.0 \
  && go mod download \
  && mkdir -p /out \
  && CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH:-amd64}" \
    go build -trimpath -buildvcs=true -o /out/livekit-server ./cmd/server \
  && go version -m /out/livekit-server | grep -F 'go1.26.6' \
  && go version -m /out/livekit-server | grep -F 'golang.org/x/mod' | grep -F 'v0.40.0'

FROM alpine:3.24.1@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b

ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/merchedits/snezhok" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="v1.13.5" \
      xyz.merchedits.snezhok.upstream-source="https://github.com/livekit/livekit" \
      xyz.merchedits.snezhok.upstream-revision="3b9f118327b257301083a7c4aa46076c8012918a"

COPY --from=build /out/livekit-server /livekit-server
COPY --from=build /src/LICENSE /licenses/livekit/LICENSE
COPY --from=build /src/NOTICE /licenses/livekit/NOTICE

ENTRYPOINT ["/livekit-server"]
