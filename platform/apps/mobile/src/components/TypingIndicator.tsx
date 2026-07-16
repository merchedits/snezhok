import { memo, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import type { UserSummary } from "@snezhok/contracts";

import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { subscribeRealtimeTyping } from "../lib/realtimeBridge";

export const TypingIndicator = memo(function TypingIndicator({ streamId, participants, reducedMotion }: { streamId: string; participants: readonly UserSummary[]; reducedMotion: boolean }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const [userIds, setUserIds] = useState<readonly string[]>([]);

  useEffect(() => subscribeRealtimeTyping(streamId, setUserIds), [streamId]);

  const names = useMemo(() => {
    const byId = new Map(participants.map((user) => [user.id, user.displayName]));
    return userIds.map((id) => byId.get(id)).filter((name): name is string => Boolean(name));
  }, [participants, userIds]);
  const label = names.length === 1
    ? t("typingOne", { name: names[0]! })
    : names.length === 2
      ? t("typingTwo", { first: names[0]!, second: names[1]! })
      : names.length > 2
        ? t("typingMany", { count: names.length })
        : "";

  return (
    <View accessibilityLiveRegion="polite" style={styles.container}>
      {label ? <><View style={styles.dots}><TypingDot delay={0} reducedMotion={reducedMotion} color={palette.accent} /><TypingDot delay={120} reducedMotion={reducedMotion} color={palette.accent} /><TypingDot delay={240} reducedMotion={reducedMotion} color={palette.accent} /></View><Text numberOfLines={1} style={[styles.label, { color: palette.secondaryText }]}>{label}</Text></> : null}
    </View>
  );
});

function TypingDot({ delay, reducedMotion, color }: { delay: number; reducedMotion: boolean; color: string }) {
  const progress = useSharedValue(reducedMotion ? 1 : 0.25);
  useEffect(() => {
    cancelAnimation(progress);
    if (reducedMotion) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(delay, withRepeat(withSequence(
      withTiming(1, { duration: 280, easing: Easing.out(Easing.quad) }),
      withTiming(0.25, { duration: 360, easing: Easing.inOut(Easing.quad) }),
    ), -1));
    return () => cancelAnimation(progress);
  }, [delay, progress, reducedMotion]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateY: -1.5 * progress.value }] }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, animatedStyle]} />;
}

const styles = StyleSheet.create({
  container: { height: 20, minWidth: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: 18 },
  dots: { width: 24, flexDirection: "row", alignItems: "center", gap: 3, marginRight: 6 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
  label: { flex: 1, fontSize: 11, lineHeight: 15, fontWeight: "500" },
});
