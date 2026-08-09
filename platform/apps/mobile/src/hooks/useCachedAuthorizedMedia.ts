import { useCallback, useEffect, useMemo, useState } from "react";

import { cachedAuthenticatedMedia, cachedAuthenticatedMediaUri, invalidateAuthenticatedMedia } from "../lib/authenticatedMediaCache";
import { useAuthorizedMedia } from "./useAuthorizedMedia";

export function useCachedAuthorizedMedia(uri: string, cacheKey: string, mimeType?: string | null) {
  const source = useAuthorizedMedia(uri);
  const initialUri = useMemo(() => cachedAuthenticatedMediaUri(cacheKey, source.uri, mimeType), [cacheKey, mimeType, source.uri]);
  const [state, setState] = useState<{ key: string; uri: string | null; loading: boolean; failed: boolean; attempt: number }>(() => ({
    key: source.uri,
    uri: initialUri,
    loading: Boolean(source.uri && !initialUri),
    failed: false,
    attempt: 0,
  }));
  const retry = useCallback(() => {
    invalidateAuthenticatedMedia(cacheKey, source.uri, mimeType);
    setState((current) => ({ ...current, key: source.uri, uri: null, loading: true, failed: false, attempt: current.attempt + 1 }));
  }, [cacheKey, mimeType, source.uri]);
  const active = state.key === source.uri ? state : { key: source.uri, uri: initialUri, loading: Boolean(source.uri && !initialUri), failed: false, attempt: 0 };

  useEffect(() => {
    let mounted = true;
    if (!source.uri || active.uri) return () => { mounted = false; };
    void cachedAuthenticatedMedia(source, cacheKey, mimeType).then((localUri) => {
      if (mounted) setState({ key: source.uri, uri: localUri, loading: false, failed: false, attempt: active.attempt });
    }).catch(() => {
      if (mounted) setState({ key: source.uri, uri: null, loading: false, failed: true, attempt: active.attempt });
    });
    return () => { mounted = false; };
  }, [active.attempt, active.uri, cacheKey, mimeType, source]);

  return { uri: active.uri, loading: active.loading, failed: active.failed, retry };
}
