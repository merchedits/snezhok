import type { ConversationSummary } from "@snezhok/contracts";
import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../../hooks/usePalette";
import { useTranslation } from "../../i18n";
import { AppIcon } from "../AppIcon";

export function ChatFolderCreateModal({ visible, conversations, titleFor, onClose, onCreate }: { visible: boolean; conversations: readonly ConversationSummary[]; titleFor: (conversation: ConversationSummary) => string; onClose: () => void; onCreate: (name: string, ids: string[]) => Promise<void> }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const chats = useMemo(() => conversations.filter((item) => !item.saved), [conversations]);
  const close = () => { if (!busy) { setName(""); setSelected(new Set()); onClose(); } };
  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try { await onCreate(trimmed, [...selected]); close(); } catch { /* Caller presents the localized failure. */ } finally { setBusy(false); }
  };
  return <Modal visible={visible} animationType="slide" onRequestClose={close}>
    <KeyboardAvoidingView behavior="padding" automaticOffset style={[styles.screen, { backgroundColor: palette.background, paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.header}><Pressable onPress={close} style={styles.control}><AppIcon name="close" size={23} color={palette.text} /></Pressable><Text style={[styles.title, { color: palette.text }]}>{t("newFolder")}</Text><Pressable disabled={!name.trim() || busy} onPress={() => void submit()} style={styles.control}><AppIcon name="checkmark" size={23} color={!name.trim() || busy ? palette.faintText : palette.accent} /></Pressable></View>
      <TextInput autoFocus value={name} onChangeText={setName} maxLength={64} placeholder={t("folderName")} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]} />
      <FlatList data={chats} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} renderItem={({ item }) => {
        const checked = selected.has(item.id);
        return <Pressable onPress={() => setSelected((current) => { const next = new Set(current); if (checked) next.delete(item.id); else next.add(item.id); return next; })} style={[styles.row, { borderColor: palette.border }]}><Text numberOfLines={1} style={[styles.chat, { color: palette.text }]}>{titleFor(item)}</Text><AppIcon name={checked ? "checkmark" : "radio-button-on-outline"} size={23} color={checked ? palette.accent : palette.faintText} /></Pressable>;
      }} />
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({ screen: { flex: 1 }, header: { height: 56, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8 }, control: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, title: { fontSize: 18, fontWeight: "900" }, input: { height: 48, marginHorizontal: 16, marginBottom: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 15, paddingHorizontal: 14, fontSize: 16 }, list: { paddingHorizontal: 16, paddingBottom: 24 }, row: { height: 54, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: StyleSheet.hairlineWidth }, chat: { flex: 1, fontSize: 15, fontWeight: "700" } });
