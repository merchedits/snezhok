import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ChannelSummary } from "@snezhok/contracts";

import { usePalette } from "../hooks/usePalette";
import { api } from "../lib/api";
import { useAppStore } from "../store/useAppStore";
import { Avatar } from "./Avatar";
import { TextEntryModal } from "./TextEntryModal";

const HOME_ID = "__home__";

interface ServerDrawerProps {
  visible: boolean;
  initialServerId?: string | undefined;
  onClose: () => void;
  onOpenChannel: (channel: ChannelSummary) => void;
  onNavigate: (destination: "chats" | "contacts" | "settings") => void;
}

export function ServerDrawer({ visible, initialServerId, onClose, onOpenChannel, onNavigate }: ServerDrawerProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const servers = useAppStore((state) => state.servers);
  const channels = useAppStore((state) => state.channels);
  const categories = useAppStore((state) => state.categories);
  const conversations = useAppStore((state) => state.conversations);
  const refresh = useAppStore((state) => state.refreshBootstrap);
  const [selectedId, setSelectedId] = useState(initialServerId ?? HOME_ID);
  const [creatingServer, setCreatingServer] = useState(false);

  useEffect(() => {
    if (visible) setSelectedId(initialServerId ?? HOME_ID);
  }, [initialServerId, servers, visible]);

  const selected = servers.find((server) => server.id === selectedId);
  const selectedChannels = useMemo(
    () => channels.filter((channel) => channel.serverId === selected?.id).sort((a, b) => a.position - b.position),
    [channels, selected?.id],
  );
  const selectedCategories = categories.filter((category) => category.serverId === selected?.id).sort((a, b) => a.position - b.position);
  const uncategorized = selectedChannels.filter((channel) => channel.categoryId === null);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: palette.overlay }]}>
        <View style={[styles.sheet, { backgroundColor: palette.surface, paddingTop: insets.top }]}> 
          <View style={[styles.rail, { backgroundColor: palette.background, paddingBottom: insets.bottom }]}> 
            <FlatList
              data={servers}
              keyExtractor={(server) => server.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.railContent}
              ListHeaderComponent={
                <>
                  <Pressable onPress={() => setSelectedId(HOME_ID)} style={styles.serverButton} accessibilityLabel="Chats and account">
                    <View style={[styles.activeMark, { backgroundColor: selectedId === HOME_ID ? palette.accent : "transparent" }]} />
                    <View style={[styles.serverAvatar, { backgroundColor: selectedId === HOME_ID ? palette.accent : palette.elevated, borderRadius: 16 }]}><Ionicons name="chatbubbles" size={23} color={selectedId === HOME_ID ? "white" : palette.text} /></View>
                  </Pressable>
                  <View style={[styles.railDivider, { backgroundColor: palette.border }]} />
                </>
              }
              ListFooterComponent={
                <Pressable onPress={() => setCreatingServer(true)} style={styles.serverButton} accessibilityLabel="Create server">
                  <View style={[styles.serverAvatar, { backgroundColor: palette.elevated, borderRadius: 24 }]}><Ionicons name="add" size={25} color={palette.success} /></View>
                </Pressable>
              }
              renderItem={({ item }) => {
                const active = item.id === selected?.id;
                return (
                  <Pressable onPress={() => setSelectedId(item.id)} style={styles.serverButton} accessibilityLabel={item.name}>
                    <View style={[styles.activeMark, { backgroundColor: active ? palette.accent : "transparent" }]} />
                    <View style={[styles.serverAvatar, { backgroundColor: active ? palette.accent : palette.elevated, borderRadius: active ? 15 : 24 }]}>
                      {item.iconUrl ? <Avatar uri={item.iconUrl} label={item.name} size={48} /> : <Text style={[styles.serverInitial, { color: active ? "white" : palette.text }]}>{item.name.charAt(0).toUpperCase()}</Text>}
                    </View>
                    {item.mentionCount > 0 ? <View style={[styles.mentionDot, { backgroundColor: palette.danger }]} /> : null}
                  </Pressable>
                );
              }}
            />
          </View>
          <View style={styles.channelPane}>
            <View style={[styles.drawerHeader, { borderColor: palette.border }]}> 
              <View style={styles.drawerTitleWrap}>
                <Text numberOfLines={1} style={[styles.drawerTitle, { color: palette.text }]}>{selected?.name ?? "Snezhok"}</Text>
                <Text style={[styles.drawerSubtitle, { color: palette.secondaryText }]}>{selected ? `${selectedChannels.length} channels` : "Private communication"}</Text>
              </View>
              <Pressable onPress={onClose} accessibilityLabel="Close server drawer" style={styles.closeButton}>
                <Ionicons name="close" size={25} color={palette.secondaryText} />
              </Pressable>
            </View>
            {selected ? <ScrollView contentContainerStyle={[styles.channelScroll, { paddingBottom: insets.bottom + 20 }]}>
              {uncategorized.map((channel) => <ChannelRow key={channel.id} channel={channel} onPress={() => onOpenChannel(channel)} />)}
              {selectedCategories.map((category) => {
                const rows = selectedChannels.filter((channel) => channel.categoryId === category.id);
                if (rows.length === 0) return null;
                return (
                  <View key={category.id} style={styles.category}>
                    <Text style={[styles.categoryLabel, { color: palette.faintText }]}>{category.name}</Text>
                    {rows.map((channel) => <ChannelRow key={channel.id} channel={channel} onPress={() => onOpenChannel(channel)} />)}
                  </View>
                );
              })}
              {selectedChannels.length === 0 ? <Text style={[styles.empty, { color: palette.secondaryText }]}>No channels yet.</Text> : null}
            </ScrollView> : <View style={[styles.homePane, { paddingBottom: insets.bottom + 12 }]}>
              <DrawerNavRow icon="chatbubbles-outline" label="Chats" detail={`${conversations.filter((item) => !item.archived).length} conversations`} onPress={() => onNavigate("chats")} />
              <DrawerNavRow icon="people-outline" label="Contacts" detail="Friends and requests" onPress={() => onNavigate("contacts")} />
              <View style={[styles.navDivider, { backgroundColor: palette.border }]} />
              <DrawerNavRow icon="settings-outline" label="Settings" detail="Appearance, storage, voice and privacy" onPress={() => onNavigate("settings")} />
            </View>}
          </View>
        </View>
        <TextEntryModal
          visible={creatingServer}
          title="Create server"
          placeholder="Server name"
          submitLabel="Create"
          onClose={() => setCreatingServer(false)}
          onSubmit={async (name) => {
            const server = await api.createServer(name);
            await refresh();
            setSelectedId(server.id);
          }}
        />
      </View>
    </Modal>
  );
}

function DrawerNavRow({ icon, label, detail, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; detail: string; onPress: () => void }) {
  const palette = usePalette();
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.navRow, { backgroundColor: pressed ? palette.elevated : "transparent" }]}><View style={[styles.navIcon, { backgroundColor: palette.accentSoft }]}><Ionicons name={icon} size={21} color={palette.accent} /></View><View style={styles.navText}><Text style={[styles.navLabel, { color: palette.text }]}>{label}</Text><Text numberOfLines={1} style={[styles.navDetail, { color: palette.secondaryText }]}>{detail}</Text></View><Ionicons name="chevron-forward" size={18} color={palette.faintText} /></Pressable>;
}

function ChannelRow({ channel, onPress }: { channel: ChannelSummary; onPress: () => void }) {
  const palette = usePalette();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.channelRow, { backgroundColor: pressed ? palette.elevated : "transparent" }]}>
      {channel.kind === "voice" ? <Ionicons name="volume-medium-outline" size={20} color={palette.secondaryText} /> : <Text style={[styles.hash, { color: palette.secondaryText }]}>#</Text>}
      <View style={styles.channelText}>
        <Text numberOfLines={1} style={[styles.channelName, { color: channel.unreadCount ? palette.text : palette.secondaryText }]}>{channel.name}</Text>
        {channel.kind === "voice" && channel.connectedMembers.length > 0 ? <Text style={[styles.connected, { color: palette.success }]}>{channel.connectedMembers.length} connected</Text> : null}
      </View>
      {channel.mentionCount > 0 ? <View style={[styles.badge, { backgroundColor: palette.danger }]}><Text style={styles.badgeText}>{channel.mentionCount}</Text></View> : channel.unreadCount > 0 ? <View style={[styles.unread, { backgroundColor: palette.accent }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  sheet: { width: "88%", height: "100%", flexDirection: "row" },
  rail: { width: 64 },
  railContent: { paddingVertical: 10, gap: 10 },
  railDivider: { width: 32, height: StyleSheet.hairlineWidth, alignSelf: "center", marginVertical: 3 },
  serverButton: { height: 56, alignItems: "center", justifyContent: "center" },
  activeMark: { position: "absolute", left: 0, width: 4, height: 34, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  serverAvatar: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  serverInitial: { fontSize: 18, fontWeight: "700" },
  mentionDot: { position: "absolute", right: 8, bottom: 4, width: 10, height: 10, borderRadius: 8 },
  channelPane: { flex: 1 },
  drawerHeader: { minHeight: 62, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16 },
  drawerTitleWrap: { flex: 1 },
  drawerTitle: { fontSize: 18, fontWeight: "800" },
  drawerSubtitle: { fontSize: 12, marginTop: 2 },
  closeButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  channelScroll: { padding: 10 },
  category: { marginTop: 18 },
  categoryLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.7, paddingHorizontal: 10, marginBottom: 6 },
  channelRow: { minHeight: 48, borderRadius: 10, flexDirection: "row", alignItems: "center", paddingHorizontal: 10, gap: 10 },
  channelText: { flex: 1 },
  channelName: { fontSize: 15, fontWeight: "600" },
  hash: { width: 20, textAlign: "center", fontSize: 21, fontWeight: "500" },
  connected: { fontSize: 11, marginTop: 2 },
  badge: { minWidth: 20, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "white", fontSize: 11, fontWeight: "800" },
  unread: { width: 7, height: 7, borderRadius: 4 },
  empty: { textAlign: "center", marginTop: 40, fontSize: 14 },
  homePane: { flex: 1, padding: 10 },
  navRow: { minHeight: 62, borderRadius: 11, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 11 },
  navIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  navText: { flex: 1 },
  navLabel: { fontSize: 15, fontWeight: "700" },
  navDetail: { fontSize: 12, marginTop: 3 },
  navDivider: { height: StyleSheet.hairlineWidth, marginVertical: 9, marginHorizontal: 10 },
});
