import { AppIcon } from "./AppIcon";
import { type ReactNode, useCallback, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { usePalette } from "../hooks/usePalette";

const REPLY_THRESHOLD = -54;
const MAX_DRAG = -76;

export function SwipeReplyRow({ children, disabled = false, onReply }: { children: ReactNode; disabled?: boolean; onReply: () => void }) {
  const palette = usePalette();
  const translation = useSharedValue(0);
  const onReplyRef = useRef(onReply);
  onReplyRef.current = onReply;
  const reply = useCallback(() => onReplyRef.current(), []);
  const gesture = useMemo(() => Gesture.Pan()
    .enabled(!disabled)
    .activeOffsetX(-10)
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      translation.value = Math.max(MAX_DRAG, Math.min(0, event.translationX));
    })
    .onEnd(() => {
      if (translation.value <= REPLY_THRESHOLD) runOnJS(reply)();
    })
    .onFinalize(() => {
      translation.value = withTiming(0, { duration: 145, easing: Easing.out(Easing.cubic) });
    }), [disabled, reply, translation]);
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translation.value }] }));
  const iconStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, -translation.value / Math.abs(REPLY_THRESHOLD))),
    transform: [{ scale: 0.72 + Math.min(1, Math.max(0, -translation.value / Math.abs(REPLY_THRESHOLD))) * 0.28 }],
  }));

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.replyIcon, { backgroundColor: palette.accent }, iconStyle]}>
        <AppIcon name="arrow-undo" size={18} color="white" />
      </Animated.View>
      <GestureDetector gesture={gesture}>
        <Animated.View style={contentStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { width: "100%", overflow: "hidden" },
  replyIcon: { position: "absolute", right: 12, top: "50%", width: 34, height: 34, marginTop: -17, borderRadius: 17, alignItems: "center", justifyContent: "center" },
});
