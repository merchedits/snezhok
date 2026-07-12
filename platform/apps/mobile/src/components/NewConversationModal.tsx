import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ConversationSummary, UserSummary } from "@snezhok/contracts";

import { usePalette } from "../hooks/usePalette";
import { api } from "../lib/api";
import { Avatar } from "./Avatar";

export function NewConversationModal({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (conversation: ConversationSummary) => void }) {
  const palette = usePalette();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!visible) { setQuery(""); setResults([]); setError(null); } }, [visible]);
  const search = async () => {
    if (!query.trim() || busy) return;
    setBusy(true); setError(null);
    try { setResults(await api.searchUsers(query.trim())); } catch (reason) { setError(reason instanceof Error ? reason.message : "Search failed"); } finally { setBusy(false); }
  };
  const create = async (user: UserSummary) => {
    setBusy(true); setError(null);
    try { onCreated(await api.createConversation([user.id])); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open chat"); } finally { setBusy(false); }
  };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]}> 
        <View style={[styles.header, { borderColor: palette.border }]}><Pressable onPress={onClose} style={styles.headerButton}><Text style={[styles.cancel, { color: palette.accent }]}>Cancel</Text></Pressable><Text style={[styles.title, { color: palette.text }]}>New message</Text><View style={styles.headerButton} /></View>
        <View style={[styles.search, { backgroundColor: palette.surface }]}><Ionicons name="search" size={18} color={palette.faintText} /><TextInput autoFocus autoCapitalize="none" value={query} onChangeText={setQuery} onSubmitEditing={() => void search()} placeholder="Name or username" placeholderTextColor={palette.faintText} style={[styles.searchInput, { color: palette.text }]} />{busy ? <ActivityIndicator size="small" color={palette.accent} /> : <Pressable onPress={() => void search()}><Text style={[styles.go, { color: palette.accent }]}>Search</Text></Pressable>}</View>
        {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
        <FlatList data={results} keyExtractor={(item) => item.id} renderItem={({ item }) => <Pressable disabled={busy} onPress={() => void create(item)} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? palette.surface : palette.background }]}><Avatar uri={item.avatarUrl} label={item.displayName} color={item.avatarColor} online={item.presence === "online"} size={46} /><View style={[styles.rowBody, { borderColor: palette.border }]}><Text style={[styles.name, { color: palette.text }]}>{item.displayName}</Text><Text style={[styles.username, { color: palette.secondaryText }]}>@{item.username}</Text></View></Pressable>} ListEmptyComponent={query && !busy ? <Text style={[styles.empty, { color: palette.secondaryText }]}>Search by name or username.</Text> : null} />
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
});
