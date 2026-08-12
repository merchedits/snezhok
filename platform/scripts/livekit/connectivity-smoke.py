#!/usr/bin/env python3
"""Dependency-free public listener smoke checks for Snezhok/LiveKit.

This proves signal TLS, ICE/TCP reachability, and valid STUN Binding responses
over UDP and the public TURN/TLS endpoint. A real two-device call remains the
release gate because a Binding response alone cannot prove that authenticated
relay allocation and media forwarding work end to end.
"""

from __future__ import annotations

import argparse
import os
import socket
import ssl
import struct
import sys
import urllib.error
import urllib.request

MAGIC_COOKIE = 0x2112A442
BINDING_REQUEST = 0x0001
BINDING_SUCCESS = 0x0101


def binding_request() -> tuple[bytes, bytes]:
    transaction = os.urandom(12)
    return struct.pack("!HHI12s", BINDING_REQUEST, 0, MAGIC_COOKIE, transaction), transaction


def validate_binding(data: bytes, transaction: bytes) -> None:
    if len(data) < 20:
        raise RuntimeError("short STUN response")
    message_type, length, cookie, response_transaction = struct.unpack("!HHI12s", data[:20])
    if message_type != BINDING_SUCCESS:
        raise RuntimeError(f"unexpected STUN response type 0x{message_type:04x}")
    if cookie != MAGIC_COOKIE or response_transaction != transaction:
        raise RuntimeError("STUN transaction validation failed")
    if length % 4 != 0:
        raise RuntimeError("invalid STUN attribute padding")
    if len(data) < 20 + length:
        raise RuntimeError("truncated STUN response")


def check_udp_stun(host: str, port: int, timeout: float) -> None:
    addresses = unique_addresses(socket.getaddrinfo(host, port, type=socket.SOCK_DGRAM))
    if not addresses:
        raise RuntimeError("TURN/UDP host resolved to no addresses")
    errors: list[str] = []
    for family, socktype, proto, _, address in addresses:
        request, transaction = binding_request()
        try:
            with socket.socket(family, socktype, proto) as connection:
                connection.settimeout(timeout)
                connection.sendto(request, address)
                data, _ = connection.recvfrom(4096)
                validate_binding(data, transaction)
        except (OSError, RuntimeError) as error:
            errors.append(f"{address[0]}: {error}")
    if errors:
        raise RuntimeError(f"TURN/UDP STUN failed for published address(es): {'; '.join(errors)}")


def receive_exact(connection: socket.socket, count: int) -> bytes:
    chunks = bytearray()
    while len(chunks) < count:
        chunk = connection.recv(count - len(chunks))
        if not chunk:
            raise RuntimeError("connection closed during STUN response")
        chunks.extend(chunk)
    return bytes(chunks)


def check_tls_stun(host: str, port: int, timeout: float) -> None:
    context = ssl.create_default_context()
    addresses = unique_addresses(socket.getaddrinfo(host, port, type=socket.SOCK_STREAM))
    if not addresses:
        raise RuntimeError("TURN/TLS host resolved to no addresses")
    errors: list[str] = []
    for family, socktype, proto, _, address in addresses:
        request, transaction = binding_request()
        try:
            with socket.socket(family, socktype, proto) as raw:
                raw.settimeout(timeout)
                raw.connect(address)
                with context.wrap_socket(raw, server_hostname=host) as connection:
                    connection.settimeout(timeout)
                    connection.sendall(request)
                    header = receive_exact(connection, 20)
                    length = struct.unpack("!H", header[2:4])[0]
                    validate_binding(header + receive_exact(connection, length), transaction)
        except (OSError, ssl.SSLError, RuntimeError) as error:
            errors.append(f"{address[0]}: {error}")
    if errors:
        raise RuntimeError(f"TURN/TLS STUN failed for published address(es): {'; '.join(errors)}")


def check_tcp(host: str, port: int, timeout: float) -> None:
    addresses = unique_addresses(socket.getaddrinfo(host, port, type=socket.SOCK_STREAM))
    if not addresses:
        raise RuntimeError("ICE/TCP host resolved to no addresses")
    errors: list[str] = []
    for family, socktype, proto, _, address in addresses:
        try:
            with socket.socket(family, socktype, proto) as connection:
                connection.settimeout(timeout)
                connection.connect(address)
        except OSError as error:
            errors.append(f"{address[0]}: {error}")
    if errors:
        raise RuntimeError(f"ICE/TCP failed for published address(es): {'; '.join(errors)}")


def unique_addresses(addresses: list[tuple]) -> list[tuple]:
    """Keep one endpoint per published IP while preserving resolver order."""
    unique: list[tuple] = []
    seen: set[tuple[int, str, int]] = set()
    for address in addresses:
        family, _, _, _, endpoint = address
        key = (family, endpoint[0], endpoint[1])
        if key not in seen:
            seen.add(key)
            unique.append(address)
    return unique


def check_signal(url: str, timeout: float) -> None:
    request = urllib.request.Request(url, method="GET", headers={"User-Agent": "SnezhokConnectivitySmoke/1"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if not 200 <= response.status < 400:
                raise RuntimeError(f"signal endpoint returned HTTP {response.status}")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"signal endpoint returned HTTP {error.code}") from error


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rtc-host", default="merchedits.xyz")
    parser.add_argument("--turn-udp-host", default="merchedits.xyz")
    parser.add_argument("--turn-tls-host", default="turn.merchedits.xyz")
    parser.add_argument("--signal-url", default="https://merchedits.xyz/chat/livekit/")
    parser.add_argument("--rtc-tcp-port", type=int, default=7881)
    parser.add_argument("--turn-udp-port", type=int, default=3478)
    # LiveKit advertises embedded TURN/TLS to clients on public port 443 even
    # when its backend listener uses 5349.
    parser.add_argument("--turn-tls-port", type=int, default=443)
    parser.add_argument("--timeout", type=float, default=8.0)
    args = parser.parse_args()

    checks = (
        ("signal HTTPS", lambda: check_signal(args.signal_url, args.timeout)),
        ("ICE/TCP", lambda: check_tcp(args.rtc_host, args.rtc_tcp_port, args.timeout)),
        ("TURN/UDP STUN", lambda: check_udp_stun(args.turn_udp_host, args.turn_udp_port, args.timeout)),
        ("TURN/TLS STUN", lambda: check_tls_stun(args.turn_tls_host, args.turn_tls_port, args.timeout)),
    )
    failed = False
    for label, check in checks:
        try:
            check()
            print(f"PASS {label}")
        except Exception as error:  # noqa: BLE001 - a smoke check reports every transport failure uniformly.
            failed = True
            print(f"FAIL {label}: {error}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
