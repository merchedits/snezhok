import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Message, UserSummary } from "@snezhok/contracts";

import { isUserVisibleStreamKind, productCapabilities } from "../config/productCapabilities";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { renderableAttachments } from "../lib/messagePayload";
import { api } from "../lib/api";
import { AppIcon } from "./AppIcon";

type SearchScope = "all" | "messages" | "media" | "files" | "links";
type ResultRow = { type: "user"; user: UserSummary } | { type: "message"; message: Message } | { type: "file"; id: string; filename: string; kind: string; bytes: number };

export function MessageSearchModal({ visible, streamId, onClose, onOpenMessage, onOpenUser }: { visible: boolean; streamId?: string; onClose: () => void; onOpenMessage: (message: Message) => void; onOpenUser?: (user: UserSummary) => void }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>("all");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const trimmed = query.trim();
    if (!trimmed && scope === "all") { setRows([]); return; }
    const timer = setTimeout(() => {
      setLoading(true);
      void api.search(trimmed, streamId, scope).then((result) => {
        if (cancelled) return;
        setRows([
          ...(streamId ? [] : result.users.map((user): ResultRow => ({ type: "user", user }))),
          ...result.messages.filter((message) => isUserVisibleStreamKind(message.streamKind)).map((message): ResultRow => ({ type: "message", message })),
          ...(streamId || productCapabilities.servers ? result.files.map((file): ResultRow => ({ type: "file", id: file.id, filename: file.filename, kind: file.kind, bytes: file.bytes })) : []),
        ]);
      }).catch(() => { if (!cancelled) setRows([]); }).finally(() => { if (!cancelled) setLoading(false); });
    }, 280);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, scope, streamId, visible]);

  const scopes = useMemo<Array<{ value: SearchScope; label: string }>>(() => [
    { value: "all", label: t("searchAll") },
    { value: "messages", label: t("searchMessages") },
    { value: "media", label: t("sharedMedia") },
    { value: "files", label: t("sharedFiles") },
    { value: "links", label: t("sharedLinks") },
  ], [t]);

  return <Modal visible={visible} animationType="slide" navigationBarTranslucent={false} onRequestClose={onClose}>
    <KeyboardAvoidingView style={[styles.screen, { backgroundColor: palette.background, paddingTop: insets.top }]} behavior="padding" automaticOffset>
      <View style={[styles.header, { borderColor: palette.border }]}><Pressable onPress={onClose} style={styles.close}><AppIcon name="chevron-back" size={25} color={palette.accent} /></Pressable><TextInput autoFocus value={query} onChangeText={setQuery} placeholder={t("searchMessagesAndFiles")} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text, backgroundColor: palette.surface }]} /></View>
      <FlatList horizontal style={{ flexGrow: 0, height: 52 }} data={scopes} keyExtractor={(item) => item.value} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scopes} renderItem={({ item }) => <Pressable onPress={() => setScope(item.value)} style={[styles.chip, { backgroundColor: scope === item.value ? palette.accent : palette.surface }]}><Text style={[styles.chipText, { color: scope === item.value ? "white" : palette.secondaryText }]}>{item.label}</Text></Pressable>} />
      {loading ? <ActivityIndicator style={styles.loading} color={palette.accent} /> : null}
      <FlatList data={rows} keyExtractor={(item) => item.type === "user" ? `u:${item.user.id}` : item.type === "message" ? `m:${item.message.id}` : `f:${item.id}`} contentContainerStyle={styles.results} renderItem={({ item }) => item.type === "user"
        ? <Pressable disabled={!onOpenUser} onPress={() => onOpenUser?.(item.user)} style={[styles.row, { borderColor: palette.border }]}><AppIcon name="person-outline" size={20} color={palette.accent} /><View style={styles.copy}><Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>{item.user.displayName}</Text><Text numberOfLines={1} style={[styles.subtitle, { color: palette.secondaryText }]}>@{item.user.username}</Text></View></Pressable>
        : item.type === "message"
        ? <Pressable onPress={() => onOpenMessage(item.message)} style={[styles.row, { borderColor: palette.border }]}><AppIcon name={renderableAttachments(item.message.attachments).length ? "document-outline" : "chatbubble-outline"} size={20} color={palette.accent} /><View style={styles.copy}><Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>{item.message.sender.displayName}</Text><Text numberOfLines={2} style={[styles.subtitle, { color: palette.secondaryText }]}>{item.message.text || t("attachment")}</Text></View><Text style={[styles.time, { color: palette.faintText }]}>{new Date(item.message.createdAt).toLocaleDateString()}</Text></Pressable>
        : <View style={[styles.row, { borderColor: palette.border }]}><AppIcon name="document-outline" size={20} color={palette.accent} /><View style={styles.copy}><Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>{item.filename}</Text><Text style={[styles.subtitle, { color: palette.secondaryText }]}>{item.kind} · {formatBytes(item.bytes)}</Text></View></View>} ListEmptyComponent={!loading ? <Text style={[styles.empty, { color: palette.secondaryText }]}>{query || scope !== "all" ? t("nothingFound") : t("searchPromptGlobal")}</Text> : null} />
    </KeyboardAvoidingView>
  </Modal>;
}

function formatBytes(bytes: number) { return bytes < 1_048_576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`; }

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth }, close: { width: 40, height: 40, alignItems: "center", justifyContent: "center" }, input: { flex: 1, height: 40, borderRadius: 12, paddingHorizontal: 12, fontSize: 16 }, scopes: { padding: 10, gap: 7 }, chip: { height: 32, borderRadius: 16, paddingHorizontal: 13, justifyContent: "center" }, chipText: { fontSize: 13, fontWeight: "700" }, loading: { marginTop: 12 }, results: { paddingHorizontal: 12, paddingBottom: 30 }, row: { minHeight: 65, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 9 }, copy: { flex: 1, minWidth: 0 }, title: { fontSize: 15, fontWeight: "700" }, subtitle: { fontSize: 13, marginTop: 3 }, time: { fontSize: 10 }, empty: { textAlign: "center", marginTop: 60, paddingHorizontal: 24 },
});
