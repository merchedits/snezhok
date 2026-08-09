import { useMemo, useSyncExternalStore } from "react";
import { Image } from "expo-image";

import { API_URL } from "../lib/api";
import { getRuntimeSession, subscribeToSession } from "../lib/secureSession";

export interface AuthenticatedMediaSource {
  uri: string;
  headers: Record<string, string>;
}

export function resolveMediaUrl(uri: string): string {
  if (/^https?:\/\//i.test(uri)) return uri;
  const apiMarker = API_URL.indexOf("/api/v1");
  const deploymentBase = apiMarker >= 0 ? API_URL.slice(0, apiMarker) : new URL(API_URL).origin;
  return `${deploymentBase}${uri.startsWith("/") ? uri : `/${uri}`}`;
}

export function useAuthorizedMedia(uri: string): AuthenticatedMediaSource {
  const token = useSyncExternalStore(
    subscribeToSession,
    () => getRuntimeSession()?.accessToken ?? "",
    () => "",
  );
  return useMemo(() => ({
    uri: resolveMediaUrl(uri),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }), [token, uri]);
}

export function prefetchAuthorizedMedia(uris: readonly string[]): Promise<boolean> {
  const urls = [...new Set(uris.filter(Boolean).map(resolveMediaUrl))];
  if (!urls.length) return Promise.resolve(true);
  const token = getRuntimeSession()?.accessToken;
  return Image.prefetch(urls, {
    cachePolicy: "memory-disk",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}
