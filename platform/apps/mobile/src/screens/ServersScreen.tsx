import Ionicons from "@expo/vector-icons/Ionicons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { ChannelSummary } from "@snezhok/contracts";

import { Avatar } from "../components/Avatar";
import { ScreenHeader } from "../components/ScreenHeader";
import { TextEntryModal } from "../components/TextEntryModal";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { api } from "../lib/api";
import { useAppStore } from "../store/useAppStore";
import type { RootStackParamList } from "../types";

export function ServersScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const palette = usePalette();
  const { t } = useTranslation();
  const servers = useAppStore((state) => state.servers);
  const channels = useAppStore((state) => state.channels);
  const refresh = useAppStore((state) => state.refreshBootstrap);
  const [selectedId, setSelectedId] = useState<string | null>(servers[0]?.id ?? null);
  const [creating, setCreating] = useState(false);
  const selected = servers.find((server) => server.id === selectedId) ?? servers[0];
  const selectedChannels = useMemo(() => channels.filter((channel) => channel.serverId === selected?.id).sort((a, b) => a.position - b.position), [channels, selected?.id]);

  const open = (channel: ChannelSummary) => {
    if (channel.kind === "voice") navigation.navigate("Call", { streamId: channel.id, title: channel.name });
    else navigation.navigate("Chat", { streamId: channel.id, streamKind: "channel", title: channel.name, subtitle: channel.topic });
  };

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}> 
      <ScreenHeader title={t("servers")} right={[{ icon: "add", label: t("createServer"), onPress: () => setCreating(true) }]} />
      {servers.length ? (
        <>
          <View style={[styles.serverStrip, { borderColor: palette.border }]}> 
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.serverStripContent}>
              {servers.map((server) => {
                const active = selected?.id === server.id;
                return <Pressable key={server.id} onPress={() => setSelectedId(server.id)} style={styles.serverChoice}><View style={[styles.serverIcon, { borderColor: active ? palette.accent : "transparent" }]}><Avatar uri={server.iconUrl} label={server.name} size={46} /></View><Text numberOfLines={1} style={[styles.serverLabel, { color: active ? palette.text : palette.secondaryText }]}>{server.name}</Text></Pressable>;
              })}
            </ScrollView>
          </View>
          <View style={styles.heading}><View style={styles.headingCopy}><Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>{selected?.name}</Text><Text style={[styles.subtitle, { color: palette.secondaryText }]}>{t("channels", { count: selectedChannels.length })}</Text></View></View>
          <FlatList data={selectedChannels} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} renderItem={({ item }) => <ChannelRow channel={item} onPress={() => open(item)} />} ListEmptyComponent={<Text style={[styles.empty, { color: palette.secondaryText }]}>{t("noChannels")}</Text>} />
        </>
      ) : <View style={styles.emptyWrap}><Ionicons name="albums-outline" size={38} color={palette.faintText} /><Text style={[styles.emptyTitle, { color: palette.text }]}>{t("noServers")}</Text><Pressable onPress={() => setCreating(true)} style={[styles.createButton, { backgroundColor: palette.accent }]}><Text style={styles.createText}>{t("createServer")}</Text></Pressable></View>}
      <TextEntryModal visible={creating} title={t("createServer")} placeholder={t("serverName")} submitLabel={t("create")} onClose={() => setCreating(false)} onSubmit={async (name) => { const server = await api.createServer(name); await refresh(); setSelectedId(server.id); }} />
    </View>
  );
}

function ChannelRow({ channel, onPress }: { channel: ChannelSummary; onPress: () => void }) {
  const palette = usePalette();
  const { t } = useTranslation();
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.channel, { backgroundColor: pressed ? palette.surface : "transparent", borderColor: palette.border }]}><View style={[styles.channelIcon, { backgroundColor: palette.accentSoft }]}>{channel.kind === "voice" ? <Ionicons name="volume-medium-outline" size={21} color={palette.accent} /> : <Text style={[styles.hash, { color: palette.accent }]}>#</Text>}</View><View style={styles.channelCopy}><Text numberOfLines={1} style={[styles.channelName, { color: palette.text }]}>{channel.name}</Text><Text numberOfLines={1} style={[styles.channelDetail, { color: channel.connectedMembers.length ? palette.success : palette.secondaryText }]}>{channel.connectedMembers.length ? t("connected", { count: channel.connectedMembers.length }) : channel.topic || t("textChannels")}</Text></View>{channel.mentionCount ? <View style={[styles.badge, { backgroundColor: palette.danger }]}><Text style={styles.badgeText}>{channel.mentionCount}</Text></View> : <Ionicons name="chevron-forward" size={18} color={palette.faintText} />}</Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  serverStrip: { borderBottomWidth: StyleSheet.hairlineWidth },
  serverStripContent: { paddingHorizontal: 12, paddingVertical: 12, gap: 12 },
  serverChoice: { width: 62, alignItems: "center", gap: 5 },
  serverIcon: { width: 52, height: 52, borderWidth: 2, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  serverLabel: { width: 62, textAlign: "center", fontSize: 11, fontWeight: "600" },
  heading: { minHeight: 62, flexDirection: "row", alignItems: "center", paddingHorizontal: 16 },
  headingCopy: { flex: 1 },
  title: { fontSize: 20, fontWeight: "800" },
  subtitle: { fontSize: 12, marginTop: 2 },
  list: { paddingHorizontal: 10, paddingBottom: 16 },
  channel: { minHeight: 62, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  channelIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  hash: { fontSize: 23, fontWeight: "600" },
  channelCopy: { flex: 1 },
  channelName: { fontSize: 16, fontWeight: "700" },
  channelDetail: { fontSize: 12, marginTop: 3 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  badgeText: { color: "white", fontSize: 11, fontWeight: "800" },
  empty: { textAlign: "center", marginTop: 60, fontSize: 14 },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 60 },
  emptyTitle: { fontSize: 18, fontWeight: "800", marginTop: 12 },
  createButton: { minHeight: 44, borderRadius: 12, paddingHorizontal: 18, alignItems: "center", justifyContent: "center", marginTop: 16 },
  createText: { color: "white", fontSize: 14, fontWeight: "800" },
});
