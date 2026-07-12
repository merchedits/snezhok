import { useSyncExternalStore } from "react";

import { API_URL } from "../lib/api";
import { getRuntimeSession, subscribeToSession } from "../lib/secureSession";

export function resolveMediaUrl(uri: string): string {
  if (/^https?:\/\//i.test(uri)) return uri;
  const apiMarker = API_URL.indexOf("/api/v1");
  const deploymentBase = apiMarker >= 0 ? API_URL.slice(0, apiMarker) : new URL(API_URL).origin;
  return `${deploymentBase}${uri.startsWith("/") ? uri : `/${uri}`}`;
}

export function useAuthorizedMedia(uri: string) {
  const token = useSyncExternalStore(
    subscribeToSession,
    () => getRuntimeSession()?.accessToken ?? "",
    () => "",
  );
  return {
    uri: resolveMediaUrl(uri),
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}
