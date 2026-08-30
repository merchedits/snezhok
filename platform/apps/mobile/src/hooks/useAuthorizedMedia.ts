import { useEffect, useMemo, useSyncExternalStore } from "react";
import { Image } from "expo-image";

import { API_URL } from "../infrastructure/http/apiConfig";
import { sessionTransport } from "../infrastructure/http/sessionTransport";
import { getRuntimeSession, subscribeToSession } from "../lib/secureSession";
import { resolveMediaUrl as resolveMediaUrlAgainst } from "../lib/mediaUrl";

export interface AuthenticatedMediaSource {
  uri: string;
  headers: Record<string, string>;
}

export function resolveMediaUrl(uri: string): string {
  return resolveMediaUrlAgainst(uri, API_URL);
}

export function useAuthorizedMedia(uri: string): AuthenticatedMediaSource {
  const session = useSyncExternalStore(
    subscribeToSession,
    getRuntimeSession,
    () => null,
  );
  const token = session?.accessToken ?? "";
  useEffect(() => {
    if (session && session.expiresAt <= Date.now() + 60_000) void refreshAuthorizedMediaSession();
  }, [session]);
  return useMemo(() => ({
    uri: resolveMediaUrl(uri),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }), [token, uri]);
}

export async function refreshAuthorizedMediaSession(): Promise<boolean> {
  if (!getRuntimeSession()) return false;
  return sessionTransport.refreshSession().catch(() => false);
}

export function authorizedMediaSource(uri: string): AuthenticatedMediaSource {
  const token = getRuntimeSession()?.accessToken;
  return {
    uri: resolveMediaUrl(uri),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}

export async function prefetchAuthorizedMedia(uris: readonly string[]): Promise<boolean> {
  const urls = [...new Set(uris.filter(Boolean).map(resolveMediaUrl))];
  if (!urls.length) return true;
  const session = getRuntimeSession();
  if (session && session.expiresAt <= Date.now() + 60_000) await refreshAuthorizedMediaSession();
  const token = getRuntimeSession()?.accessToken;
  return Image.prefetch(urls, {
    cachePolicy: "memory-disk",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).catch(() => false);
}
