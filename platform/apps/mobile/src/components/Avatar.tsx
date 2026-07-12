import { Image, StyleSheet, Text, View } from "react-native";

import { usePalette } from "../hooks/usePalette";
import { useAuthorizedMedia } from "../hooks/useAuthorizedMedia";

interface AvatarProps {
  uri: string | null;
  label: string;
  color?: string | undefined;
  size?: number;
  online?: boolean;
}

export function Avatar({ uri, label, color = "#637184", size = 48, online = false }: AvatarProps) {
  const palette = usePalette();
  const source = useAuthorizedMedia(uri ?? "");
  const initial = label.trim().charAt(0).toUpperCase() || "?";
  return (
    <View style={{ width: size, height: size }}>
      {uri ? (
        <Image source={source} style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]} />
      ) : (
        <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
          <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial}</Text>
        </View>
      )}
      {online ? (
        <View
          style={[
            styles.presence,
            {
              width: size * 0.26,
              height: size * 0.26,
              borderRadius: size,
              backgroundColor: palette.success,
              borderColor: palette.background,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  image: { resizeMode: "cover" },
  fallback: { alignItems: "center", justifyContent: "center" },
  initial: { color: "white", fontWeight: "700" },
  presence: { position: "absolute", right: 0, bottom: 0, borderWidth: 2 },
});
