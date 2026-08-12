import { memo, useEffect, useState } from "react";
import { Image, type ImageContentFit } from "expo-image";
import { ActivityIndicator, StyleSheet, Text, View, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";

import { recordDiagnostic } from "../diagnostics/diagnostics";
import { useAuthorizedMedia } from "../hooks/useAuthorizedMedia";

interface AuthenticatedImageProps {
  uri: string;
  fallbackUri?: string | null;
  cacheKey: string;
  mimeType?: string | null;
  resizeMode?: ImageContentFit;
  style: StyleProp<ImageStyle>;
  showLoader?: boolean;
}

export const AuthenticatedImage = memo(function AuthenticatedImage({ uri, fallbackUri, cacheKey, resizeMode = "cover", style, showLoader = false }: AuthenticatedImageProps) {
  const primarySource = useAuthorizedMedia(uri);
  // Hooks cannot be conditional. Resolving the primary twice is harmless and
  // keeps the fallback authorization header synchronized after token refresh.
  const fallbackSource = useAuthorizedMedia(fallbackUri || uri);
  const [usingFallback, setUsingFallback] = useState(false);
  const [loading, setLoading] = useState(showLoader);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUsingFallback(false);
    setLoading(showLoader);
    setFailed(false);
  }, [fallbackUri, showLoader, uri]);

  const source = usingFallback ? fallbackSource : primarySource;
  const canFallback = Boolean(fallbackUri && fallbackUri !== uri && !usingFallback);
  return (
    <View style={[styles.frame, style as StyleProp<ViewStyle>]}>
      {!failed ? <Image
        source={source}
        cachePolicy="memory-disk"
        contentFit={resizeMode}
        recyclingKey={`${cacheKey}:${usingFallback ? "original" : "preferred"}`}
        transition={0}
        onLoadStart={() => { if (showLoader) setLoading(true); }}
        onLoad={() => { setLoading(false); setFailed(false); }}
        onError={() => {
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
