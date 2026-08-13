# Call connectivity and TURN/TLS

Snezhok signaling is served at `wss://merchedits.xyz/chat/livekit/`. The SFU
already exposes direct ICE/UDP on UDP 7882, direct ICE/TCP on TCP 7881, and
TURN/UDP on UDP 3478 with relay ports UDP 40000-40007. The intentionally
small eight-port pool is sufficient for the current two-person private test
deployment and can be forwarded as individual ports on consumer routers that
do not support ranges.

The TURN certificate renewal is pinned to an RSA key and the `ISRG Root X1` preferred chain for compatibility with older Android/WebRTC trust stores. After renewal, run the public connectivity smoke test; HTTPS signaling, ICE/TCP, TURN/UDP, and TURN/TLS must all pass before a call release. A healthy LiveKit container alone does not prove certificate compatibility.

## Authoritative room lifecycle

Client tokens never create rooms. `room.auto_create` is disabled and the API
creates each random call room through the production-internal
`LIVEKIT_CONTROL_URL` before returning a token. In Compose that endpoint is
`http://host.docker.internal:7880`; it must not be routed through public Nginx.
The host-gateway entry and loopback-only API port are intentional trust
boundaries.

LiveKit signs lifecycle webhooks with `LIVEKIT_WEBHOOK_API_KEY` and sends them
to `http://127.0.0.1:3003/api/v1/livekit/webhook`. The key is injected from the
same protected API-key environment value and is never written to YAML. Do not
remove the webhook URL: participant joins are the durable evidence used to
distinguish a real room from a notification/token phantom.

End, direct decline/direct leave, block, kick, ban, membership and media-grant
permission mutations commit a durable whole-room termination command in the
same database transaction as the authorization change. Whole-room termination
is intentionally conservative: LiveKit cannot revoke a grant for an identity
which has not joined yet, so removing only a currently connected participant
would leave an old five-minute token usable. The worker revokes every connected
participant token before deletion and retries sanitized failures with a lease.
Calls in which no participant webhook is ever observed expire after
`CALL_PHANTOM_TIMEOUT_SECONDS` (120 seconds by default). Shared-room local leave
does not end the room; it only removes that participant. A moderator end ends
the room for everyone.

The deployment gate must confirm all of the following with two accounts:

1. ending or declining a direct call disconnects both clients and an old token
   cannot recreate the deleted room;
2. kicking, banning, blocking or changing `connect`, `speak`, `video` or
   `screen_share` ends the current room for everyone; authorized members may
   start or join only the newly created room;
3. restoring permission allows only a freshly issued token to reconnect;
4. an unanswered call disappears shortly after the phantom timeout; and
5. stopping LiveKit leaves pending database commands which complete after it
   restarts, without logging credentials or response bodies.

Notification answers carry the exact call ID and the API refuses to mint media
credentials if that call has ended or a newer call now occupies the chat. The
client also rejects incoming-call actions more than 90 seconds after their
server timestamp. Tapping a delayed Android notification must never create an
unintended new call.

The remaining production fallback is TURN/TLS. LiveKit's embedded TURN server
listens on its configured backend port (5349 here), but advertises TURN/TLS to
clients as public port 443. Exposing backend port 5349 directly therefore does
not make the fallback usable. The public endpoint must be
`turn.merchedits.xyz:443`, backed by LiveKit on `127.0.0.1:5349`. This matches
the [LiveKit deployment guidance](https://docs.livekit.io/transport/self-hosting/deployment/)
and [port reference](https://docs.livekit.io/transport/self-hosting/ports-firewall/).

HTTP path proxying cannot carry TURN. It is raw TLS and must be routed at layer
4. Because this host also serves several HTTPS domains on TCP 443, use TLS SNI
before either protocol terminates:

```text
public TCP 443
        |
        +-- SNI turn.merchedits.xyz --> Nginx stream strip proxy --> LiveKit TLS 127.0.0.1:5349
        |
        `-- every other SNI ----------> existing Nginx HTTPS 127.0.0.1:8443
```

The public stream listener sends PROXY protocol to retain the real client
address for the existing HTTPS virtual hosts. The local TURN adapter consumes
that header before passing the untouched TLS stream to LiveKit, which does not
accept a PROXY header on its embedded TURN listener.

## External prerequisites

Do not deploy the TURN/TLS production mount until all of these are true:

1. Create an A/AAAA record for `turn.merchedits.xyz` pointing to the same public
   address as the server. If IPv6 is not actually routed to the host, do not
   publish an AAAA record.
2. Issue a publicly trusted certificate whose SAN covers
   `turn.merchedits.xyz`. Use an HTTP-01 webroot on port 80; do not let Certbot
   rewrite the layer-4 listener.
3. Confirm the router forwards TCP 443, TCP 7881, UDP 3478, UDP 7882, and UDP
   40000-40007 to `192.168.2.11`, and allow the same set in the host firewall.
4. Schedule a maintenance window for the Nginx listener migration. Prepare a
   tested rollback copy before touching the current 443 listeners.

## Install the TURN certificate

Copy the validated certificate into LiveKit's read-only mount without printing
the private key:

```bash
sudo TURN_DOMAIN=turn.merchedits.xyz \
  scripts/livekit/install-turn-certificate.sh \
  /etc/letsencrypt/live/turn.merchedits.xyz/fullchain.pem \
  /etc/letsencrypt/live/turn.merchedits.xyz/privkey.pem
```

The installer rejects mismatched, expired, and incorrectly named material. It
keeps the copied private key readable only by root and LiveKit's runtime group
(GID 65532 by default); it never makes the key world-readable. Use `--restart`
only after the merged Compose configuration is the normal production
configuration.

## Migrate Nginx TCP 443 without losing HTTPS

`infra/nginx/turn-sni-routing.conf.example` is a reviewed top-level `stream`
template. It cannot be dropped into `/etc/nginx/conf.d`, because Ubuntu includes
that directory inside the `http` block.

1. Back up `/etc/nginx` and capture `nginx -T`.
2. Change every existing HTTPS virtual host from `listen ...:443 ssl` to the
   same `listen 127.0.0.1:8443 ssl proxy_protocol` socket. All virtual hosts on
   that socket must use identical listen options.
3. Inside the `http` block, trust only the local stream listener:

   ```nginx
   set_real_ip_from 127.0.0.1;
   real_ip_header proxy_protocol;
   ```

4. Include the template as a top-level `stream` block from `nginx.conf`, outside
   `http { ... }`. Never configure an HTTP `location` for TURN.
5. Render the production LiveKit configuration, then start its 5349 backend:

   ```bash
   docker compose -f docker-compose.production.yml config --quiet
   docker compose -f docker-compose.production.yml up -d --no-deps --force-recreate livekit
   ```

6. Before reloading Nginx, prove both local backends are listening. Run
   `sudo nginx -t`, reload, and immediately check every hosted HTTPS domain. A
   failed HTTPS check is a rollback condition.

## Connectivity release gate

Run the dependency-free transport smoke test from a machine outside the home
network:

```bash
python3 scripts/livekit/connectivity-smoke.py
```

It verifies public signal HTTPS, ICE/TCP, a STUN Binding transaction over
TURN/UDP, and a certificate-verified STUN Binding transaction against the
actual client endpoint `turn.merchedits.xyz:443`. Checking localhost or port
5349 is not release evidence. The probe checks every published A and AAAA
address independently. If IPv6 is not routed all the way to LiveKit, remove the
AAAA record instead of accepting success from IPv4 while leaving intermittent
IPv6 failures in production.

The smoke test cannot authenticate a TURN allocation or prove media flow.
Complete a two-device audio/video call with Wi-Fi disabled, then repeat through
a network or VPN that blocks UDP. Diagnostics must show a relay/TCP candidate,
and call setup, reconnect, mute, speaker route, and teardown must all succeed.
Open Call details during the strict-firewall run and verify that the selected
ICE candidate is `relay` and the expected TCP/TLS protocol is reported; a
successful signaling websocket is not TURN evidence.

After this route is live, install `scripts/livekit/certbot-deploy-hook.sh` as
`/etc/letsencrypt/renewal-hooks/deploy/snezhok-turn-livekit`. It validates and
copies only the renewed `turn.merchedits.xyz` lineage, preserves the restricted
runtime-group permissions, and recreates LiveKit. Every renewal must be
followed by the public smoke test and a failed test must alert an operator.
