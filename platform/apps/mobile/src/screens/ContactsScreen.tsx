import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import type { FriendEntry } from "@snezhok/contracts";

import { Avatar } from "../components/Avatar";
import { ScreenHeader } from "../components/ScreenHeader";
import { TextEntryModal } from "../components/TextEntryModal";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { api } from "../lib/api";
import { useAppStore } from "../store/useAppStore";
import type { RootStackParamList } from "../types";

type Filter = "friends" | "requests";

export function ContactsScreen({ embedded = false }: { embedded?: boolean }) {
  const palette = usePalette();
  const { language, t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const me = useAppStore((state) => state.me);
  const friends = useAppStore((state) => state.friends);
  const conversations = useAppStore((state) => state.conversations);
  const [filter, setFilter] = useState<Filter>("friends");
  const [adding, setAdding] = useState(false);
  const refresh = useAppStore((state) => state.refreshBootstrap);
  const items = useMemo(() => friends.filter((entry) => filter === "friends" ? entry.relationship === "friend" : entry.relationship === "incoming" || entry.relationship === "outgoing"), [filter, friends]);

  const openFriend = (entry: FriendEntry) => {
    const direct = conversations.find((conversation) => conversation.kind === "direct" && conversation.participants.some((user) => user.id === entry.user.id));
    if (direct) navigation.navigate("Chat", { streamId: direct.id, streamKind: "conversation", title: direct.title });
  };

  const profileHeader = embedded && me ? <View style={[styles.profileCard, { backgroundColor: palette.surface, borderColor: palette.border }]}><Avatar uri={me.avatarUrl} label={me.displayName} color={me.avatarColor} online size={62} /><View style={styles.profileCopy}><Text numberOfLines={1} style={[styles.profileName, { color: palette.text }]}>{me.displayName}</Text><Text style={[styles.profileUsername, { color: palette.secondaryText }]}>@{me.username}</Text>{me.statusText ? <Text numberOfLines={1} style={[styles.profileStatus, { color: palette.accent }]}>{me.statusText}</Text> : null}</View></View> : null;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}> 
      <ScreenHeader title={embedded ? t("profile") : t("contacts")} {...(!embedded ? { left: { icon: "chevron-back" as const, label: t("back"), onPress: navigation.goBack } } : {})} right={[{ icon: "person-add-outline", label: t("addContact"), onPress: () => setAdding(true) }]} />
      <FlatList data={items} keyExtractor={(item) => item.user.id} ListHeaderComponent={<>{profileHeader}<View style={[styles.segment, { backgroundColor: palette.surface }]}>{(["friends", "requests"] as const).map((value) => <Pressable key={value} onPress={() => setFilter(value)} style={[styles.segmentButton, { backgroundColor: filter === value ? palette.elevated : "transparent" }]}><Text style={[styles.segmentText, { color: filter === value ? palette.text : palette.secondaryText }]}>{value === "friends" ? t("contacts") : t("requests")}</Text></Pressable>)}</View></>} renderItem={({ item }) => <Pressable onPress={() => openFriend(item)} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? palette.surface : palette.background }]}><Avatar uri={item.user.avatarUrl} label={item.user.displayName} color={item.user.avatarColor} online={item.user.presence === "online"} size={48} /><View style={[styles.body, { borderColor: palette.border }]}><Text style={[styles.name, { color: palette.text }]}>{item.user.displayName}</Text><Text numberOfLines={1} style={[styles.status, { color: palette.secondaryText }]}>{relationshipLabel(item, language, t)}</Text></View>{item.relationship === "incoming" && item.requestId ? <View style={styles.requestActions}><Pressable onPress={(event) => { event.stopPropagation(); void respond(item, "decline"); }} style={[styles.requestButton, { backgroundColor: palette.surface }]}><Text style={[styles.requestText, { color: palette.secondaryText }]}>{t("decline")}</Text></Pressable><Pressable onPress={(event) => { event.stopPropagation(); void respond(item, "accept"); }} style={[styles.requestButton, { backgroundColor: palette.accent }]}><Text style={styles.acceptText}>{t("accept")}</Text></Pressable></View> : null}</Pressable>} ListEmptyComponent={<View style={styles.empty}><Text style={[styles.emptyTitle, { color: palette.text }]}>{filter === "friends" ? t("noContacts") : t("noRequests")}</Text></View>} />
      <TextEntryModal visible={adding} title={t("addContact")} placeholder={t("username")} submitLabel={t("sendRequest")} onClose={() => setAdding(false)} onSubmit={async (username) => { await api.requestFriend(username); await refresh(); }} />
    </View>
  );

  async function respond(entry: FriendEntry, action: "accept" | "decline") { if (!entry.requestId) return; await api.respondFriend(entry.requestId, action); await refresh(); }
}

function relationshipLabel(entry: FriendEntry, language: "en" | "ru", t: ReturnType<typeof useTranslation>["t"]): string {
  if (entry.relationship === "incoming") return t("requestIncoming");
  if (entry.relationship === "outgoing") return t("requestSent");
  if (entry.user.statusText) return entry.user.statusText;
  if (entry.user.presence === "online") return t("online");
  return t("lastSeen", { date: new Date(entry.user.lastSeenAt).toLocaleDateString(language === "ru" ? "ru-RU" : "en-US") });
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, profileCard: { margin: 12, marginBottom: 2, borderWidth: 1, borderRadius: 17, padding: 16, flexDirection: "row", alignItems: "center", gap: 14 }, profileCopy: { flex: 1 }, profileName: { fontSize: 20, fontWeight: "800" }, profileUsername: { fontSize: 14, marginTop: 3 }, profileStatus: { fontSize: 13, marginTop: 5 },
  segment: { flexDirection: "row", borderRadius: 10, margin: 10, padding: 3 }, segmentButton: { flex: 1, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center" }, segmentText: { fontSize: 14, fontWeight: "700" },
  row: { minHeight: 68, flexDirection: "row", alignItems: "center", paddingLeft: 12 }, body: { minHeight: 68, flex: 1, marginLeft: 12, justifyContent: "center", borderBottomWidth: StyleSheet.hairlineWidth, paddingRight: 12 }, name: { fontSize: 16, fontWeight: "600" }, status: { fontSize: 13, marginTop: 4 },
  empty: { paddingTop: 70, alignItems: "center" }, emptyTitle: { fontSize: 17, fontWeight: "700" }, requestActions: { flexDirection: "row", gap: 6, paddingRight: 9 }, requestButton: { minHeight: 34, borderRadius: 8, paddingHorizontal: 9, alignItems: "center", justifyContent: "center" }, requestText: { fontSize: 11, fontWeight: "700" }, acceptText: { color: "white", fontSize: 11, fontWeight: "700" },
});
