import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

import type { LinkPreview } from "@snezhok/contracts";

import { linkPreviewUseCases } from "../../application/messaging/linkPreviewUseCases";
import { firstPreviewUrl } from "../../domains/messaging/linkPreviewPolicy";
import { usePalette } from "../../hooks/usePalette";

const cache = new Map<string, Promise<LinkPreview | null>>();

export function MessageLinkPreview({ text }: { text: string }) {
  const palette = usePalette();
  const url = useMemo(() => firstPreviewUrl(text), [text]);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  useEffect(() => {
    let active = true;
    if (!url) { setPreview(null); return; }
    let pending = cache.get(url);
    if (!pending) { pending = linkPreviewUseCases.load(url).catch(() => null); cache.set(url, pending); if (cache.size > 200) cache.delete(cache.keys().next().value!); }
    void pending.then((value) => { if (active) setPreview(value); });
    return () => { active = false; };
  }, [url]);
  if (!url || !preview) return null;
  return <Pressable accessibilityRole="link" accessibilityLabel={`${preview.title}, ${preview.hostname}`} onPress={() => void Linking.openURL(preview.url).catch(() => undefined)} style={[styles.card, { borderColor: palette.accent, backgroundColor: palette.surface }]}>
    <View style={styles.copy}><Text numberOfLines={1} style={[styles.host, { color: palette.accent }]}>{preview.hostname}</Text><Text numberOfLines={2} style={[styles.title, { color: palette.text }]}>{preview.title}</Text>{preview.description ? <Text numberOfLines={2} style={[styles.description, { color: palette.secondaryText }]}>{preview.description}</Text> : null}</View>
  </Pressable>;
}

const styles = StyleSheet.create({ card: { marginTop: 7, borderLeftWidth: 3, borderRadius: 10, padding: 9, maxWidth: 280 }, copy: { minWidth: 0 }, host: { fontSize: 11, lineHeight: 14, fontWeight: "700" }, title: { marginTop: 2, fontSize: 14, lineHeight: 18, fontWeight: "800" }, description: { marginTop: 2, fontSize: 12, lineHeight: 16 } });
