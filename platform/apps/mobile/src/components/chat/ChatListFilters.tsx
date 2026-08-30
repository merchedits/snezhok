import type { ChatFolder } from "../../types";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";

import { usePalette } from "../../hooks/usePalette";
import { useTranslation } from "../../i18n";
import { AppIcon } from "../AppIcon";

export type ChatListFilter = "all" | "archived" | `folder:${string}`;

export function ChatListFilters({ folders, selected, onSelect, onCreate }: { folders: readonly ChatFolder[]; selected: ChatListFilter; onSelect: (filter: ChatListFilter) => void; onCreate: () => void }) {
  const palette = usePalette();
  const { t } = useTranslation();
  const chips: Array<{ key: ChatListFilter; label: string }> = [
    { key: "all", label: t("allChats") },
    { key: "archived", label: t("archivedChats") },
    ...folders.map((folder) => ({ key: `folder:${folder.id}` as const, label: folder.name })),
  ];
  return <ScrollView style={styles.scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} keyboardShouldPersistTaps="handled">
    {chips.map((chip) => <Pressable key={chip.key} onPress={() => onSelect(chip.key)} style={[styles.chip, { backgroundColor: selected === chip.key ? palette.accent : palette.surface }]}><Text numberOfLines={1} style={[styles.label, { color: selected === chip.key ? palette.onAccent : palette.secondaryText }]}>{chip.label}</Text></Pressable>)}
    <Pressable accessibilityRole="button" accessibilityLabel={t("newFolder")} onPress={onCreate} style={[styles.add, { backgroundColor: palette.surface }]}><AppIcon name="add" size={19} color={palette.accent} /></Pressable>
  </ScrollView>;
}

const styles = StyleSheet.create({ scroll: { flexGrow: 0, flexShrink: 0 }, strip: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 7, gap: 7, alignItems: "center" }, chip: { maxWidth: 150, height: 34, borderRadius: 17, paddingHorizontal: 14, justifyContent: "center" }, label: { fontSize: 13, fontWeight: "800" }, add: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" } });
