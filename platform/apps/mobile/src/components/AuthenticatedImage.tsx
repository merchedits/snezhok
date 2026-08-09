import { memo } from "react";
import { Image, type ImageContentFit } from "expo-image";
import { type ImageStyle, type StyleProp } from "react-native";

import { useAuthorizedMedia } from "../hooks/useAuthorizedMedia";

interface AuthenticatedImageProps {
  uri: string;
  cacheKey: string;
  mimeType?: string | null;
  resizeMode?: ImageContentFit;
  style: StyleProp<ImageStyle>;
  showLoader?: boolean;
}

export const AuthenticatedImage = memo(function AuthenticatedImage({ uri, cacheKey, resizeMode = "cover", style }: AuthenticatedImageProps) {
  const source = useAuthorizedMedia(uri);
  return (
    <Image
      source={source}
      cachePolicy="memory-disk"
      contentFit={resizeMode}
      recyclingKey={cacheKey}
      transition={0}
      style={style}
    />
  );
});
