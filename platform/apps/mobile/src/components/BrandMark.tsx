import { Image, StyleSheet, View } from "react-native";

const icon = require("../../assets/snezhok-icon.png");

export function BrandMark({ size = 88 }: { size?: number }) {
  return (
    <View style={[styles.frame, { width: size, height: size, borderRadius: Math.round(size * 0.28) }]}>
      <Image source={icon} resizeMode="cover" style={styles.image} accessibilityLabel="Snezhok" />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: "hidden", alignSelf: "center" },
  image: { width: "100%", height: "100%" },
});
