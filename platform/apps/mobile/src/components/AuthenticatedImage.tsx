import { memo } from "react";
import { ActivityIndicator, Image, type ImageResizeMode, type ImageStyle, Pressable, type StyleProp, View } from "react-native";

import { useCachedAuthorizedMedia } from "../hooks/useCachedAuthorizedMedia";
import { usePalette } from "../hooks/usePalette";

interface AuthenticatedImageProps {
  uri: string;
  cacheKey: string;
  mimeType?: string | null;
  resizeMode?: ImageResizeMode;
  style: StyleProp<ImageStyle>;
  showLoader?: boolean;
}

export const AuthenticatedImage = memo(function AuthenticatedImage({ uri, cacheKey, mimeType, resizeMode = "cover", style, showLoader = false }: AuthenticatedImageProps) {
  const palette = usePalette();
  const media = useCachedAuthorizedMedia(uri, cacheKey, mimeType);
  if (media.uri) return <Image source={{ uri: media.uri }} resizeMode={resizeMode} style={style} onError={media.retry} />;
  if (media.failed) return <Pressable accessibilityRole="button" onPress={media.retry} style={[style, { backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={palette.accent} size="small" /></Pressable>;
  return <View style={[style, { backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" }]}>{showLoader ? <ActivityIndicator color={palette.accent} size="small" /> : null}</View>;
});
