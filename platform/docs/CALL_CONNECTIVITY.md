# Call connectivity and TURN/TLS

Snezhok signaling is served at `wss://merchedits.xyz/chat/livekit/`. The SFU
already exposes direct ICE/UDP on UDP 7882, direct ICE/TCP on TCP 7881, and
TURN/UDP on UDP 3478 with relay ports UDP 40000-40100.

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

Do not activate `infra/docker-compose.turn-tls.yml` until all of these are true:

1. Create an A/AAAA record for `turn.merchedits.xyz` pointing to the same public
   address as the server. If IPv6 is not actually routed to the host, do not
   publish an AAAA record.
2. Issue a publicly trusted certificate whose SAN covers
   `turn.merchedits.xyz`. Use an HTTP-01 webroot on port 80; do not let Certbot
   rewrite the layer-4 listener.
3. Confirm the router forwards TCP 443, TCP 7881, UDP 3478, UDP 7882, and UDP
   40000-40100 to `192.168.2.11`, and allow the same set in the host firewall.
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

The installer rejects mismatched, expired, incorrectly named, and
group/world-readable destination layouts. Use `--restart` only after the merged
Compose configuration is the normal production configuration.

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
5. Render the merged LiveKit configuration, then start its 5349 backend:

   ```bash
   docker compose -f docker-compose.production.yml -f infra/docker-compose.turn-tls.yml config --quiet
   docker compose -f docker-compose.production.yml -f infra/docker-compose.turn-tls.yml up -d --no-deps --force-recreate livekit
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
5349 is not release evidence.

The smoke test cannot authenticate a TURN allocation or prove media flow.
Complete a two-device audio/video call with Wi-Fi disabled, then repeat through
a network or VPN that blocks UDP. Diagnostics must show a relay/TCP candidate,
and call setup, reconnect, mute, speaker route, and teardown must all succeed.

Add the certificate installer to the Certbot deploy hook only after this route
is live. Every renewal must be followed by the public smoke test and a failed
test must alert an operator.
