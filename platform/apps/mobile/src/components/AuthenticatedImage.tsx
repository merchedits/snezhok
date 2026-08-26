import { memo, useEffect, useState } from "react";
import { Image, type ImageContentFit } from "expo-image";
import { ActivityIndicator, StyleSheet, Text, View, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";

import { recordDiagnostic } from "../diagnostics/diagnostics";
import { refreshAuthorizedMediaSession, useAuthorizedMedia } from "../hooks/useAuthorizedMedia";

// Expo already owns the bounded memory/disk bytes. This tiny index only avoids
// drawing a loading spinner over an image that was displayed earlier in the
// same app session (a frequent source of visible flicker when reopening chats).
const displayedImageUris = new Set<string>();

interface AuthenticatedImageProps {
  uri: string;
  fallbackUri?: string | null;
  cacheKey: string;
  mimeType?: string | null;
  resizeMode?: ImageContentFit;
  style: StyleProp<ImageStyle>;
  showLoader?: boolean;
  onIntrinsicSize?: (width: number, height: number) => void;
}

export const AuthenticatedImage = memo(function AuthenticatedImage({ uri, fallbackUri, cacheKey, resizeMode = "cover", style, showLoader = false, onIntrinsicSize }: AuthenticatedImageProps) {
  const primarySource = useAuthorizedMedia(uri);
  // Hooks cannot be conditional. Resolving the primary twice is harmless and
  // keeps the fallback authorization header synchronized after token refresh.
  const fallbackSource = useAuthorizedMedia(fallbackUri || uri);
  const [usingFallback, setUsingFallback] = useState(false);
  const [loading, setLoading] = useState(showLoader && !displayedImageUris.has(primarySource.uri));
  const [failed, setFailed] = useState(false);
  const [authorizationAttempt, setAuthorizationAttempt] = useState(0);
  const [authorizationRefreshed, setAuthorizationRefreshed] = useState(false);

  useEffect(() => {
    setUsingFallback(false);
    setLoading(showLoader && !displayedImageUris.has(primarySource.uri));
    setFailed(false);
    setAuthorizationAttempt(0);
    setAuthorizationRefreshed(false);
    if (showLoader && !displayedImageUris.has(primarySource.uri)) {
      void Image.getCachePathAsync(primarySource.uri).then((cachedPath) => {
        if (!cachedPath) return;
        displayedImageUris.add(primarySource.uri);
        setLoading(false);
      }).catch(() => undefined);
    }
  }, [fallbackUri, primarySource.uri, showLoader, uri]);

  const source = usingFallback ? fallbackSource : primarySource;
  const canFallback = Boolean(fallbackUri && fallbackUri !== uri && !usingFallback);
  return (
    <View style={[styles.frame, style as StyleProp<ViewStyle>]}>
      {!failed ? <Image
        source={source}
        cachePolicy="memory-disk"
        contentFit={resizeMode}
        recyclingKey={`${cacheKey}:${usingFallback ? "original" : "preferred"}:${authorizationAttempt}`}
        transition={0}
        onLoadStart={() => { if (showLoader && !displayedImageUris.has(source.uri)) setLoading(true); }}
        onLoad={(event) => {
          displayedImageUris.add(source.uri);
          setLoading(false);
          setFailed(false);
          const { width, height } = event.source;
          if (width > 0 && height > 0) onIntrinsicSize?.(width, height);
        }}
        onError={() => {
          if (!authorizationRefreshed) {
            setAuthorizationRefreshed(true);
            void refreshAuthorizedMediaSession().then((refreshed) => {
              if (refreshed) setAuthorizationAttempt((value) => value + 1);
              else if (canFallback) setUsingFallback(true);
              else {
                setLoading(false);
                setFailed(true);
                recordDiagnostic("warn", "media", "Authenticated image session refresh failed", { failure: "authorization" });
              }
            });
            return;
          }
          if (canFallback) {
            setUsingFallback(true);
            setLoading(showLoader);
            return;
          }
          setLoading(false);
          setFailed(true);
          recordDiagnostic("warn", "media", "Authenticated image failed", { failure: usingFallback ? "original" : "preferred" });
        }}
        style={StyleSheet.absoluteFill}
      /> : <View accessibilityRole="image" style={styles.failed}><Text style={styles.failedMark}>!</Text></View>}
      {showLoader && loading ? <View pointerEvents="none" style={styles.loading}><ActivityIndicator color="rgba(128,128,128,0.72)" size="small" /></View> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  frame: { overflow: "hidden" },
  loading: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" },
  failed: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(128,128,128,0.12)" },
  failedMark: { color: "rgba(128,128,128,0.8)", fontSize: 18, fontWeight: "800" },
});
