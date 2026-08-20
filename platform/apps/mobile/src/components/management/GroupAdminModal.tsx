import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { UserSummary } from "@snezhok/contracts";

import { groupUseCases, type GroupMember } from "../../application/management/groupUseCases";
import { usePalette } from "../../hooks/usePalette";
import { useTranslation } from "../../i18n";
import { productCopy } from "../../lib/productCopy";
import { userFacingError } from "../../lib/userFacingError";
import { useAppStore } from "../../store/useAppStore";
import { Avatar } from "../Avatar";
import { useAppDialog, type AppDialogAction } from "../AppDialogProvider";
import { ManagementEmpty, ManagementModal, ManagementRow, ManagementScroll, ManagementSection } from "./ManagementUi";

export function GroupAdminModal({ visible, conversationId, onClose }: { visible: boolean; conversationId: string | null; onClose: () => void }) {
  const palette = usePalette(); const { language, t } = useTranslation(); const showDialog = useAppDialog(); const lock = useRef(false);
  const me = useAppStore((state) => state.me); const conversation = useAppStore((state) => state.conversations.find((item) => item.id === conversationId));
  const applyConversation = useAppStore((state) => state.applyConversation); const refresh = useAppStore((state) => state.refreshBootstrap);
  const [members, setMembers] = useState<GroupMember[]>([]); const [busy, setBusy] = useState(false); const [editing, setEditing] = useState(false); const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false); const [query, setQuery] = useState(""); const [results, setResults] = useState<UserSummary[]>([]);
  const pc = useCallback((key: Parameters<typeof productCopy>[1]) => productCopy(language, key), [language]);
  const actor = members.find((item) => item.user.id === me?.id); const canManage = actor?.role === "owner" || actor?.role === "admin";
  const load = useCallback(async () => { if (!conversationId) return; setBusy(true); try { setMembers(await groupUseCases.members(conversationId)); } catch (error) { showDialog(pc("operationFailed"), userFacingError(error, t)); onClose(); } finally { setBusy(false); } }, [conversationId, onClose, pc, showDialog, t]);
  useEffect(() => { if (visible) { setTitle(conversation?.title ?? ""); void load(); } else { setEditing(false); setAdding(false); setQuery(""); setResults([]); } }, [conversation?.title, load, visible]);
  const run = async (action: () => Promise<unknown>, reload = true) => { if (lock.current) return; lock.current = true; setBusy(true); try { await action(); if (reload) await load(); } catch (error) { showDialog(pc("operationFailed"), userFacingError(error, t)); } finally { lock.current = false; setBusy(false); } };
  const saveTitle = () => void run(async () => { if (!conversationId || !title.trim()) return; const next = await groupUseCases.update(conversationId, { title: title.trim() }); applyConversation(next); setEditing(false); }, false);
  const photo = async () => {
    if (!conversationId) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { showDialog(t("permissionPhotos"), t("allowPhotos")); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: true, aspect: [1, 1] }); const asset = result.assets?.[0]; if (!asset) return;
      await run(async () => { const next = await groupUseCases.updatePhoto(conversationId, { uri: asset.uri, filename: asset.fileName ?? `group-${Date.now()}.jpg`, mimeType: asset.mimeType ?? "image/jpeg", kind: "image", quality: "high" }); applyConversation(next); }, false);
    } catch (error) { showDialog(pc("operationFailed"), userFacingError(error, t)); }
  };
  const memberActions = (member: GroupMember) => {
    if (!conversationId || member.user.id === me?.id || !canManage || member.role === "owner") return;
    const actions: AppDialogAction[] = [{ text: pc("cancel"), style: "cancel" }];
    if (actor?.role === "owner") actions.unshift({ text: pc(member.role === "admin" ? "removeAdmin" : "makeAdmin"), onPress: () => void run(() => groupUseCases.setMemberRole(conversationId, member, member.role === "admin" ? "member" : "admin")) });
    actions.unshift({ text: pc("removeMember"), style: "destructive", onPress: () => void run(() => groupUseCases.removeMember(conversationId, member)) });
    if (actor?.role === "owner") actions.unshift({ text: pc("transferOwnership"), style: "destructive", onPress: () => void run(() => groupUseCases.transferOwnership(conversationId, member.user.id)) });
    showDialog(member.user.displayName, undefined, actions);
  };
  return <ManagementModal visible={visible} title={pc("groupManagement")} onClose={onClose} busy={busy}>
    <ManagementScroll>
      <ManagementSection title={pc("overview")}>
        {editing ? <View style={styles.editRow}><TextInput autoFocus value={title} onChangeText={setTitle} maxLength={80} style={[styles.input, { color: palette.text, backgroundColor: palette.background, borderColor: palette.border }]} /><Pressable disabled={!title.trim()} onPress={saveTitle}><Text style={{ color: palette.accent, fontWeight: "800" }}>{pc("save")}</Text></Pressable></View> : <ManagementRow icon="create-outline" label={conversation?.title ?? pc("groupName")} {...(canManage ? { onPress: () => setEditing(true) } : {})} />}
        {canManage ? <ManagementRow icon="camera" label={pc("groupPhoto")} onPress={() => void photo()} /> : null}
      </ManagementSection>
      <ManagementSection title={`${pc("members")} · ${members.length}`}>
        {members.length ? members.map((member) => { const manageable = member.user.id !== me?.id && member.role !== "owner" && (actor?.role === "owner" || (actor?.role === "admin" && member.role === "member")); return <Pressable key={member.user.id} disabled={!manageable} onPress={() => memberActions(member)} style={[styles.member, { borderColor: palette.border }]}><Avatar uri={member.user.avatarUrl} label={member.user.displayName} color={member.user.avatarColor} size={42} /><View style={styles.memberCopy}><Text style={{ color: palette.text, fontWeight: "700" }}>{member.user.displayName}</Text><Text style={{ color: palette.secondaryText, fontSize: 12 }}>{member.role === "owner" ? pc("owner") : member.role === "admin" ? pc("administrator") : pc("member")}</Text></View></Pressable>; }) : <ManagementEmpty text={pc("noItems")} />}
        {canManage ? <ManagementRow icon="person-add-outline" label={pc("addMember")} onPress={() => setAdding(true)} /> : null}
      </ManagementSection>
      {actor && actor.role !== "owner" ? <ManagementSection><ManagementRow icon="log-out-outline" label={pc("leaveGroup")} destructive onPress={() => conversationId && showDialog(pc("leaveGroup"), undefined, [{ text: pc("cancel"), style: "cancel" }, { text: pc("leaveGroup"), style: "destructive", onPress: () => void run(async () => { await groupUseCases.leave(conversationId); await refresh({ force: true }); onClose(); }, false) }])} /></ManagementSection> : null}
      {adding ? <View style={styles.addBlock}><View style={[styles.search, { backgroundColor: palette.surface }]}><TextInput autoCapitalize="none" value={query} onChangeText={setQuery} onSubmitEditing={() => { if (query.trim()) void run(async () => setResults(await groupUseCases.searchUsers(query)), false); }} placeholder={pc("search")} placeholderTextColor={palette.faintText} style={[styles.searchInput, { color: palette.text }]} /><Pressable disabled={!query.trim()} onPress={() => void run(async () => setResults(await groupUseCases.searchUsers(query)), false)}><Text style={{ color: palette.accent, opacity: query.trim() ? 1 : 0.45 }}>{pc("search")}</Text></Pressable></View>{results.filter((user) => !members.some((member) => member.user.id === user.id)).map((user) => <Pressable key={user.id} onPress={() => conversationId && void run(async () => { await groupUseCases.addMember(conversationId, user.id); setAdding(false); setResults([]); setQuery(""); })} style={styles.result}><Avatar uri={user.avatarUrl} label={user.displayName} color={user.avatarColor} size={40} /><Text style={{ color: palette.text, fontWeight: "700" }}>{user.displayName}</Text></Pressable>)}</View> : null}
    </ManagementScroll>
    {busy ? <View pointerEvents="none" style={[styles.busy, { backgroundColor: palette.overlay }]}><ActivityIndicator color="white" /></View> : null}
  </ManagementModal>;
}

const styles = StyleSheet.create({ editRow: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12 }, input: { flex: 1, height: 42, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10 }, member: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth }, memberCopy: { flex: 1 }, addBlock: { marginHorizontal: 12, marginTop: 14 }, search: { height: 44, borderRadius: 11, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 }, searchInput: { flex: 1 }, result: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8 }, busy: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" } });
