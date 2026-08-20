import { AppIcon } from "./AppIcon";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ConversationSummary, UserSummary } from "@snezhok/contracts";

import { peopleUseCases } from "../application/people/peopleUseCases";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { productCopy } from "../lib/productCopy";
import { userFacingError } from "../lib/userFacingError";
import { Avatar } from "./Avatar";

export function NewConversationModal({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (conversation: ConversationSummary) => void }) {
  const palette = usePalette();
  const { language, t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState(false);
  const [selected, setSelected] = useState<UserSummary[]>([]);
  const [groupTitle, setGroupTitle] = useState("");
  const pc = (key: Parameters<typeof productCopy>[1], values?: Record<string, string | number>) => productCopy(language, key, values);
  useEffect(() => { if (!visible) { setQuery(""); setResults([]); setError(null); setGroupMode(false); setSelected([]); setGroupTitle(""); } }, [visible]);
  const search = async () => {
    if (!query.trim() || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(null);
    try { setResults(await peopleUseCases.search(query)); } catch (reason) { setError(userFacingError(reason, t, "searchFailed")); } finally { busyRef.current = false; setBusy(false); }
  };
  const create = async (user: UserSummary) => {
    if (groupMode) { setSelected((items) => items.some((item) => item.id === user.id) ? items.filter((item) => item.id !== user.id) : items.length < 99 ? [...items, user] : items); return; }
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(null);
    try { onCreated(await peopleUseCases.createDirect(user.id)); } catch (reason) { setError(userFacingError(reason, t, "openChatFailed")); } finally { busyRef.current = false; setBusy(false); }
  };
  const createGroup = async () => {
    if (busyRef.current || selected.length < 2 || !groupTitle.trim()) return;
    busyRef.current = true; setBusy(true); setError(null);
    try { onCreated(await peopleUseCases.createGroup(selected, groupTitle)); }
    catch (reason) { setError(userFacingError(reason, t, "openChatFailed")); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={busy ? undefined : onClose}>
      <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}> 
      <KeyboardAvoidingView style={styles.screen} behavior="padding" automaticOffset>
        <View style={[styles.header, { borderColor: palette.border }]}><Pressable disabled={busy} onPress={onClose} style={styles.headerButton}><Text style={[styles.cancel, { color: palette.accent, opacity: busy ? 0.45 : 1 }]}>{t("cancel")}</Text></Pressable><Text style={[styles.title, { color: palette.text }]}>{groupMode ? pc("createGroup") : t("newMessage")}</Text><Pressable disabled={busy} onPress={() => { setGroupMode((value) => !value); setSelected([]); }} style={styles.headerButton}><Text numberOfLines={1} style={[styles.mode, { color: palette.accent, opacity: busy ? 0.45 : 1 }]}>{groupMode ? pc("directChat") : pc("createGroup")}</Text></Pressable></View>
        {groupMode ? <><TextInput value={groupTitle} onChangeText={setGroupTitle} maxLength={80} placeholder={pc("groupName")} placeholderTextColor={palette.faintText} style={[styles.titleInput, { color: palette.text, backgroundColor: palette.surface }]} /><Text style={[styles.selectionCount, { color: palette.secondaryText }]}>{pc("selectedCount", { count: selected.length })}</Text></> : null}
        <View style={[styles.search, { backgroundColor: palette.surface }]}><AppIcon name="search" size={18} color={palette.faintText} /><TextInput autoFocus autoCapitalize="none" value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder={t("nameOrUsername")} placeholderTextColor={palette.faintText} style={[styles.searchInput, { color: palette.text }]} />{busy ? <ActivityIndicator size="small" color={palette.accent} /> : <Pressable onPress={() => void search()}><Text style={[styles.go, { color: palette.accent }]}>{t("search")}</Text></Pressable>}</View>
        {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
        <FlatList data={results} keyExtractor={(item) => item.id} contentContainerStyle={groupMode ? styles.withCreate : undefined} renderItem={({ item }) => { const checked = selected.some((user) => user.id === item.id); return <Pressable disabled={busy} onPress={() => void create(item)} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? palette.surface : palette.background }]}>{groupMode ? <View style={[styles.check, { borderColor: checked ? palette.accent : palette.border, backgroundColor: checked ? palette.accent : "transparent" }]}>{checked ? <AppIcon name="checkmark" size={16} color="white" /> : null}</View> : null}<Avatar uri={item.avatarUrl} label={item.displayName} color={item.avatarColor} online={item.presence === "online"} size={46} /><View style={[styles.rowBody, { borderColor: palette.border }]}><Text style={[styles.name, { color: palette.text }]}>{item.displayName}</Text><Text style={[styles.username, { color: palette.secondaryText }]}>@{item.username}</Text></View></Pressable>; }} ListEmptyComponent={query && !busy && !error ? <Text style={[styles.empty, { color: palette.secondaryText }]}>{t("nothingFound")}</Text> : null} />
        {groupMode ? <Pressable disabled={selected.length < 2 || !groupTitle.trim() || busy} onPress={() => void createGroup()} style={[styles.createGroup, { backgroundColor: palette.accent, opacity: selected.length < 2 || !groupTitle.trim() ? 0.45 : 1 }]}>{busy ? <ActivityIndicator color="white" /> : <Text style={styles.createGroupText}>{pc("createGroup")}</Text>}</Pressable> : null}
      </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { height: 52, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth },
  headerButton: { width: 80, height: "100%", alignItems: "center", justifyContent: "center" },
  cancel: { fontSize: 15 },
  title: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "800" },
  search: { height: 40, borderRadius: 10, margin: 12, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 7 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  go: { fontSize: 13, fontWeight: "700" },
  error: { fontSize: 13, textAlign: "center", paddingHorizontal: 12, marginBottom: 8 },
  row: { height: 66, flexDirection: "row", alignItems: "center", paddingLeft: 12 },
  rowBody: { height: "100%", flex: 1, justifyContent: "center", marginLeft: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 16, fontWeight: "700" },
  username: { fontSize: 13, marginTop: 3 },
  empty: { textAlign: "center", marginTop: 70, fontSize: 14 },
  mode: { fontSize: 11, fontWeight: "700", textAlign: "center" }, titleInput: { height: 44, borderRadius: 10, marginHorizontal: 12, marginTop: 10, paddingHorizontal: 12, fontSize: 15 }, selectionCount: { fontSize: 12, marginHorizontal: 16, marginTop: 7 }, check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, marginRight: 8, alignItems: "center", justifyContent: "center" }, withCreate: { paddingBottom: 78 }, createGroup: { position: "absolute", left: 16, right: 16, bottom: 14, height: 50, borderRadius: 13, alignItems: "center", justifyContent: "center" }, createGroupText: { color: "white", fontSize: 15, fontWeight: "800" },
});
