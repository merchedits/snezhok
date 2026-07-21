import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import type { Message } from "@snezhok/contracts";

import { usePalette } from "../../hooks/usePalette";
import { useTranslation } from "../../i18n";
import { productApi } from "../../lib/productApi";
import { productCopy } from "../../lib/productCopy";
import { useAppStore } from "../../store/useAppStore";
import type { RootStackParamList } from "../../types";
import { Avatar } from "../Avatar";
import { ManagementEmpty, ManagementModal } from "./ManagementUi";

export function MentionsModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>(); const palette = usePalette(); const { language, t } = useTranslation();
  const conversations = useAppStore((state) => state.conversations); const channels = useAppStore((state) => state.channels);
  const [items, setItems] = useState<Message[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  const pc = useCallback((key: Parameters<typeof productCopy>[1]) => productCopy(language, key), [language]);
  const load = useCallback(async (before?: string) => { setBusy(true); setFailed(false); try { const page = await productApi.mentions(before); setItems((current) => before ? [...current, ...page.items] : page.items); setCursor(page.nextCursor); } catch { setFailed(true); } finally { setBusy(false); } }, []);
  useEffect(() => { if (visible) void load(); else { setItems([]); setCursor(null); } }, [load, visible]);
  const open = (message: Message) => {
    const conversation = conversations.find((item) => item.id === message.streamId); const channel = channels.find((item) => item.id === message.streamId);
    onClose();
    requestAnimationFrame(() => navigation.navigate("Chat", { streamId: message.streamId, streamKind: message.streamKind, title: conversation?.title ?? channel?.name ?? pc("mentions"), targetMessageId: message.id, openedAt: performance.now() }));
  };
  return <ManagementModal visible={visible} title={pc("mentions")} onClose={onClose} busy={busy}>
    <FlatList data={items} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} renderItem={({ item }) => <Pressable onPress={() => open(item)} style={({ pressed }) => [styles.row, { borderColor: palette.border, opacity: pressed ? 0.65 : 1 }]}><Avatar uri={item.sender.avatarUrl} label={item.sender.displayName} color={item.sender.avatarColor} size={42} /><View style={styles.copy}><View style={styles.line}><Text numberOfLines={1} style={[styles.name, { color: palette.text }]}>{item.sender.displayName}</Text><Text style={[styles.time, { color: palette.secondaryText }]}>{new Date(item.createdAt).toLocaleString(language === "ru" ? "ru-RU" : "en-US")}</Text></View><Text numberOfLines={2} style={[styles.text, { color: palette.secondaryText }]}>{item.text || pc("messages")}</Text></View></Pressable>} ListEmptyComponent={busy ? <ActivityIndicator style={styles.loader} color={palette.accent} /> : failed ? <View style={styles.failed}><ManagementEmpty text={pc("operationFailed")} /><Pressable accessibilityRole="button" onPress={() => void load()} style={[styles.retry, { backgroundColor: palette.accentSoft }]}><Text style={{ color: palette.accent, fontWeight: "700" }}>{t("retry")}</Text></Pressable></View> : <ManagementEmpty text={pc("noMentions")} />} ListFooterComponent={cursor && !busy ? <Pressable onPress={() => void load(cursor)} style={styles.more}><Text style={{ color: palette.accent, fontWeight: "700" }}>{pc("loadMore")}</Text></Pressable> : null} />
  </ManagementModal>;
}

const styles = StyleSheet.create({ list: { paddingHorizontal: 12, paddingBottom: 24 }, row: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: StyleSheet.hairlineWidth }, copy: { flex: 1, paddingVertical: 10 }, line: { flexDirection: "row", alignItems: "center", gap: 8 }, name: { flex: 1, fontSize: 15, fontWeight: "700" }, time: { fontSize: 10 }, text: { fontSize: 13, lineHeight: 18, marginTop: 3 }, loader: { marginTop: 50 }, failed: { alignItems: "center" }, retry: { minHeight: 40, borderRadius: 10, justifyContent: "center", paddingHorizontal: 18, marginTop: -22 }, more: { height: 52, alignItems: "center", justifyContent: "center" } });
