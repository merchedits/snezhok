import { memo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { AppIcon } from "./AppIcon";
import type { ChatFolder } from "../types";
import { useAppStore } from "../store/useAppStore";
import { GroupAdminModal } from "./management/GroupAdminModal";

interface ConversationActionsSheetProps {
  visible: boolean;
  title: string;
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  unread: boolean;
  onPin: () => void;
  onArchive: () => void;
  onMute: () => void;
  onMarkUnread: () => void;
  onAddToFolder: () => void;
  folders: ChatFolder[];
  conversationId: string | null;
  onToggleFolder: (folder: ChatFolder, included: boolean) => void;
}

export const ConversationActionsSheet = memo(function ConversationActionsSheet({ visible, title, busy, pinned, archived, muted, unread, onClose, onDelete, onPin, onArchive, onMute, onMarkUnread, onAddToFolder, folders, conversationId, onToggleFolder }: ConversationActionsSheetProps) {
  const palette = usePalette();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const group = useAppStore((state) => state.conversations.find((item) => item.id === conversationId)?.kind === "group");
  const [manageId, setManageId] = useState<string | null>(null);
  return <><Modal transparent visible={visible} animationType="fade" navigationBarTranslucent={false} onRequestClose={onClose}>
    <Pressable disabled={busy} onPress={onClose} style={[styles.overlay, { backgroundColor: palette.overlay }]}>
      <Pressable style={[styles.sheet, { backgroundColor: palette.navigation, borderColor: palette.outline, paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={[styles.handle, { backgroundColor: palette.faintText }]} />
        <Text numberOfLines={1} style={[styles.title, { color: palette.text }]}>{title}</Text>
        {group && conversationId ? <SheetAction icon="settings-outline" label={t("settings")} onPress={() => { setManageId(conversationId); onClose(); }} /> : null}
        <SheetAction icon="pin-outline" label={t(pinned ? "unpinChat" : "pinChat")} onPress={onPin} />
        <SheetAction icon="bookmark" label={t(archived ? "unarchiveChat" : "archiveChat")} onPress={onArchive} />
        <SheetAction icon="volume-mute" label={t(muted ? "unmuteChat" : "muteChat")} onPress={onMute} />
        {!unread ? <SheetAction icon="mail-outline" label={t("markUnread")} onPress={onMarkUnread} /> : null}
        {folders.map((folder) => {
          const included = Boolean(conversationId && folder.streams.some((stream) => stream.streamKind === "conversation" && stream.streamId === conversationId));
          return <SheetAction key={folder.id} icon={included ? "checkmark" : "bookmark"} label={`${included ? "✓ " : "+ "}${folder.name}`} onPress={() => onToggleFolder(folder, !included)} />;
        })}
        <SheetAction icon="bookmark" label={t("newFolderWithChat")} onPress={onAddToFolder} />
        <Pressable disabled={busy} onPress={onDelete} style={({ pressed }) => [styles.action, { backgroundColor: pressed ? palette.accentSoft : "transparent", opacity: busy ? 0.55 : 1 }]}>
          <View style={[styles.iconTile, { backgroundColor: palette.moment.pink }]}>{busy ? <ActivityIndicator color={palette.danger} /> : <AppIcon name="trash-outline" size={21} color={palette.danger} />}</View>
          <Text style={[styles.actionText, { color: palette.danger }]}>{t("deleteChat")}</Text>
        </Pressable>
      </Pressable>
    </Pressable>
  </Modal><GroupAdminModal visible={manageId !== null} conversationId={manageId} onClose={() => setManageId(null)} /></>;
});

function SheetAction({ icon, label, onPress }: { icon: "pin-outline" | "bookmark" | "volume-mute" | "checkmark" | "mail-outline" | "settings-outline"; label: string; onPress: () => void }) {
  const palette = usePalette();
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.action, { backgroundColor: pressed ? palette.accentSoft : "transparent" }]}><View style={[styles.iconTile, { backgroundColor: palette.moment.lavender }]}><AppIcon name={icon} size={21} color={palette.text} /></View><Text style={[styles.actionText, { color: palette.text }]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopWidth: 1.5, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 12, paddingTop: 9 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", opacity: 0.5 },
  title: { margin: 14, marginBottom: 6, fontSize: 21, fontWeight: "900", letterSpacing: -0.4 },
  action: { height: 58, borderRadius: 16, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  iconTile: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  actionText: { fontSize: 16, fontWeight: "800" },
});
