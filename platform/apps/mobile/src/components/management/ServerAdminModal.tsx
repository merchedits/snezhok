import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import type { ChannelPermissionOverride, MemberRole, ServerAuditEntry, ServerPermission, ServerRoleDefinition } from "@snezhok/contracts";
import { serverPermissionValues } from "@snezhok/contracts";

import { serverUseCases, type ServerBan, type ServerDetails, type ServerMemberView } from "../../application/management/serverUseCases";
import { usePalette } from "../../hooks/usePalette";
import { useTranslation } from "../../i18n";
import { productCopy } from "../../lib/productCopy";
import { userFacingError } from "../../lib/userFacingError";
import { useAppStore } from "../../store/useAppStore";
import { Avatar } from "../Avatar";
import { useAppDialog, type AppDialogAction } from "../AppDialogProvider";
import { TextEntryModal } from "../TextEntryModal";
import { ManagementEmpty, ManagementModal, ManagementRow, ManagementScroll, ManagementSection } from "./ManagementUi";

type Tab = "overview" | "channels" | "members" | "roles" | "bans" | "audit";
type Editor =
  | { type: "server" }
  | { type: "category"; id?: string }
  | { type: "channel"; id?: string; kind?: "text" | "voice" }
  | { type: "memberSearch" }
  | { type: "role" }
  | null;

export function ServerAdminModal({ visible, serverId, initialTab = "overview", onClose }: { visible: boolean; serverId: string | null; initialTab?: Tab; onClose: () => void }) {
  const palette = usePalette(); const { language, t } = useTranslation(); const showDialog = useAppDialog(); const lock = useRef(false);
  const me = useAppStore((state) => state.me); const server = useAppStore((state) => state.servers.find((item) => item.id === serverId));
  // React 19 requires useSyncExternalStore snapshots to remain referentially
  // stable until the store changes. Filtering inside a Zustand selector
  // allocates a new array for every snapshot read and causes an infinite update
  // loop. This modal is mounted by the hidden Servers tab during startup
  // warm-up, so the loop used to terminate the app even when it was never
  // opened.
  const allCategories = useAppStore((state) => state.categories); const allChannels = useAppStore((state) => state.channels);
  const categories = useMemo(() => allCategories.filter((item) => item.serverId === serverId), [allCategories, serverId]);
  const channels = useMemo(() => allChannels.filter((item) => item.serverId === serverId), [allChannels, serverId]);
  const refresh = useAppStore((state) => state.refreshBootstrap);
  const [tab, setTab] = useState<Tab>("overview"); const [busy, setBusy] = useState(false); const [details, setDetails] = useState<ServerDetails | null>(null);
  const [members, setMembers] = useState<ServerMemberView[]>([]); const [roles, setRoles] = useState<ServerRoleDefinition[]>([]); const [bans, setBans] = useState<ServerBan[]>([]); const [audit, setAudit] = useState<ServerAuditEntry[]>([]); const [editor, setEditor] = useState<Editor>(null);
  const [permissionRole, setPermissionRole] = useState<ServerRoleDefinition | null>(null); const [overrideChannelId, setOverrideChannelId] = useState<string | null>(null);
  const pc = useCallback((key: Parameters<typeof productCopy>[1]) => productCopy(language, key), [language]);
  const permissions = new Set(details?.authorization.permissions ?? []); const owner = details?.authorization.role === "owner";
  const load = useCallback(async () => { if (!serverId) return; setBusy(true); try { const next = await serverUseCases.loadManagement(serverId); setDetails(next.details); setMembers(next.members); setRoles(next.roles); } catch (error) { showDialog(pc("operationFailed"), userFacingError(error, t)); onClose(); } finally { setBusy(false); } }, [onClose, pc, serverId, showDialog, t]);
  useEffect(() => { if (visible) { setTab(initialTab); void load(); } else { setEditor(null); setPermissionRole(null); setOverrideChannelId(null); } }, [initialTab, load, visible]);
  useEffect(() => { if (!visible || !serverId) return; if (tab === "bans" && permissions.has("ban_members")) void serverUseCases.bans(serverId).then(setBans).catch(() => setBans([])); if (tab === "audit" && permissions.has("view_audit_log")) void serverUseCases.audit(serverId).then((value) => setAudit(value.items)).catch(() => setAudit([])); }, [serverId, tab, visible]);
  const run = async (action: () => Promise<unknown>, reload = true) => { if (lock.current) return; lock.current = true; setBusy(true); try { await action(); if (reload) await Promise.all([load(), refresh({ force: true })]); } catch (error) { showDialog(pc("operationFailed"), userFacingError(error, t)); } finally { lock.current = false; setBusy(false); } };
  const photo = async () => { if (!serverId) return; try { const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!permission.granted) { showDialog(t("permissionPhotos"), t("allowPhotos")); return; } const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: true, aspect: [1, 1] }); const asset = result.assets?.[0]; if (!asset) return; await run(() => serverUseCases.updateIcon(serverId, { uri: asset.uri, filename: asset.fileName ?? `server-${Date.now()}.jpg`, mimeType: asset.mimeType ?? "image/jpeg", kind: "image", quality: "high" })); } catch (error) { showDialog(pc("operationFailed"), userFacingError(error, t)); } };
  const canActOnMember = (member: ServerMemberView) => {
    if (member.user.id === me?.id || member.role === "owner") return false;
    const actorRole = details?.authorization.role;
    if (actorRole === "owner") return true;
    if (actorRole === "admin") return member.role === "moderator" || member.role === "member";
    return member.role === "member";
  };
  const memberMenu = (member: ServerMemberView) => {
    if (!serverId || !canActOnMember(member)) return;
    const actions: AppDialogAction[] = [];
    const assignableRoles: Array<Exclude<MemberRole, "owner">> = owner ? ["admin", "moderator", "member"] : details?.authorization.role === "admin" ? ["moderator", "member"] : ["member"];
    if (permissions.has("manage_members")) actions.push(...assignableRoles.filter((role) => role !== member.role).map((role) => ({ text: memberRoleLabel(role, pc), onPress: () => void run(() => serverUseCases.updateMember(serverId, member.user.id, { role })) })));
    if (owner) actions.push({ text: pc("transferOwnership"), style: "destructive", onPress: () => void run(() => serverUseCases.transfer(serverId, member.user.id)) });
    if (permissions.has("kick_members")) actions.push({ text: pc("kick"), style: "destructive", onPress: () => void run(() => serverUseCases.kickMember(serverId, member.user.id)) });
    if (permissions.has("ban_members")) actions.push({ text: pc("ban"), style: "destructive", onPress: () => void run(() => serverUseCases.banMember(serverId, member.user.id)) });
    actions.push({ text: pc("cancel"), style: "cancel" });
    showDialog(member.user.displayName, undefined, actions);
  };
  const submitEditor = async (value: string) => {
    if (!serverId) return;
    if (editor?.type === "server") await serverUseCases.update(serverId, { name: value });
    if (editor?.type === "category") editor.id ? await serverUseCases.updateCategory(serverId, editor.id, { name: value }) : await serverUseCases.createCategory(serverId, value);
    if (editor?.type === "channel") editor.id ? await serverUseCases.updateChannel(serverId, editor.id, { name: value }) : await serverUseCases.createChannel(serverId, { name: value, kind: editor.kind ?? "text", categoryId: null, topic: "" });
    if (editor?.type === "memberSearch") { if (!await serverUseCases.addMemberByUsername(serverId, value)) throw new Error(pc("userNotFound")); }
    if (editor?.type === "role") { const role = await serverUseCases.createRole(serverId, value); setPermissionRole(role); }
    setEditor(null); await Promise.all([load(), refresh({ force: true })]);
  };

  const tabs = (["overview", "channels", "members", "roles", "bans", "audit"] as Tab[]).filter((item) => item !== "bans" || permissions.has("ban_members")).filter((item) => item !== "audit" || permissions.has("view_audit_log"));
  const transferActions: AppDialogAction[] = [
    ...members.filter((item) => item.user.id !== me?.id).map((item) => ({ text: item.user.displayName, onPress: () => { if (serverId) void run(() => serverUseCases.transfer(serverId, item.user.id)); } })),
    { text: pc("cancel"), style: "cancel" },
  ];
  return <ManagementModal visible={visible} title={server?.name ?? pc("serverManagement")} onClose={onClose} busy={busy}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabs}>{tabs.map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, { backgroundColor: tab === item ? palette.accent : palette.surface }]}><Text style={{ color: tab === item ? "white" : palette.secondaryText, fontWeight: "700", fontSize: 12 }}>{pc(item === "channels" ? "channels" : item === "members" ? "members" : item === "roles" ? "roles" : item === "bans" ? "bans" : item === "audit" ? "auditLog" : "overview")}</Text></Pressable>)}</ScrollView>
    {tab === "overview" ? <ManagementScroll><ManagementSection>
      <ManagementRow icon="create-outline" label={server?.name ?? "—"} {...(permissions.has("manage_server") ? { onPress: () => setEditor({ type: "server" }) } : {})} />
      {permissions.has("manage_server") ? <ManagementRow icon="camera" label={pc("serverIcon")} onPress={() => void photo()} /> : null}
    </ManagementSection><ManagementSection>
      {owner && members.length > 1 ? <ManagementRow icon="swap-horizontal-outline" label={pc("transferServer")} onPress={() => showDialog(pc("transferServer"), undefined, transferActions)} /> : null}
      {!owner && me && serverId ? <ManagementRow icon="log-out-outline" label={pc("leaveServer")} destructive onPress={() => showDialog(pc("leaveServer"), undefined, [{ text: pc("cancel"), style: "cancel" }, { text: pc("leaveServer"), style: "destructive", onPress: () => void run(async () => { await serverUseCases.leave(serverId, me.id); onClose(); }) }])} /> : null}
      {owner && serverId ? <ManagementRow icon="trash-outline" label={pc("deleteServer")} destructive onPress={() => showDialog(pc("deleteServer"), undefined, [{ text: pc("cancel"), style: "cancel" }, { text: pc("deleteServer"), style: "destructive", onPress: () => void run(async () => { await serverUseCases.remove(serverId); await refresh({ force: true }); onClose(); }, false) }], { dismissible: false })} /> : null}
    </ManagementSection></ManagementScroll> : null}
    {tab === "channels" ? <ManagementScroll><ManagementSection title={pc("categories")}>{categories.map((category) => <ManagementRow key={category.id} icon="folder-outline" label={category.name} {...(permissions.has("manage_categories") ? { onPress: () => showDialog(category.name, undefined, [{ text: pc("edit"), onPress: () => setEditor({ type: "category", id: category.id }) }, { text: pc("delete"), style: "destructive", onPress: () => { if (serverId) void run(() => serverUseCases.removeCategory(serverId, category.id)); } }, { text: pc("cancel"), style: "cancel" }]) } : {})} />)}{permissions.has("manage_categories") ? <ManagementRow icon="add" label={pc("addCategory")} onPress={() => setEditor({ type: "category" })} /> : null}</ManagementSection><ManagementSection title={pc("channels")}>{channels.map((channel) => <ManagementRow key={channel.id} icon={channel.kind === "voice" ? "volume-medium-outline" : "chatbubble-outline"} label={channel.name} detail={channel.topic} {...(permissions.has("manage_channels") ? { onPress: () => showDialog(channel.name, undefined, [{ text: pc("edit"), onPress: () => setEditor({ type: "channel", id: channel.id }) }, ...(permissions.has("manage_roles") ? [{ text: pc("overrides"), onPress: () => setOverrideChannelId(channel.id) }] : []), { text: pc("delete"), style: "destructive", onPress: () => { if (serverId) void run(() => serverUseCases.removeChannel(serverId, channel.id)); } }, { text: pc("cancel"), style: "cancel" }]) } : {})} />)}{permissions.has("manage_channels") ? <ManagementRow icon="add" label={pc("addChannel")} onPress={() => showDialog(pc("addChannel"), undefined, [{ text: pc("textChannel"), onPress: () => setEditor({ type: "channel", kind: "text" }) }, { text: pc("voiceChannel"), onPress: () => setEditor({ type: "channel", kind: "voice" }) }, { text: pc("cancel"), style: "cancel" }])} /> : null}</ManagementSection></ManagementScroll> : null}
    {tab === "members" ? <FlatList contentContainerStyle={styles.list} data={members} keyExtractor={(item) => item.user.id} renderItem={({ item }) => { const actionable = canActOnMember(item) && (permissions.has("manage_members") || permissions.has("kick_members") || permissions.has("ban_members") || owner); return <Pressable disabled={!actionable} onPress={() => memberMenu(item)} style={[styles.member, { borderColor: palette.border }]}><Avatar uri={item.user.avatarUrl} label={item.user.displayName} color={item.user.avatarColor} size={43} /><View style={styles.memberCopy}><Text style={{ color: palette.text, fontWeight: "700" }}>{item.user.displayName}</Text><Text style={{ color: palette.secondaryText, fontSize: 12 }}>{memberRoleLabel(item.role, pc)}</Text></View></Pressable>; }} ListFooterComponent={permissions.has("manage_members") ? <ManagementRow icon="person-add-outline" label={pc("addMember")} onPress={() => setEditor({ type: "memberSearch" })} /> : null} /> : null}
    {tab === "roles" ? <FlatList contentContainerStyle={styles.list} data={roles} keyExtractor={(item) => item.id} renderItem={({ item }) => <ManagementRow icon="shield-outline" label={item.name} detail={`${item.permissions.length} · ${item.position}`} {...(permissions.has("manage_roles") ? { onPress: () => setPermissionRole(item) } : {})} />} ListFooterComponent={permissions.has("manage_roles") ? <ManagementRow icon="add" label={pc("addRole")} onPress={() => setEditor({ type: "role" })} /> : null} /> : null}
    {tab === "bans" ? <FlatList contentContainerStyle={styles.list} data={bans} keyExtractor={(item) => item.user.id} renderItem={({ item }) => <ManagementRow icon="ban-outline" label={item.user.displayName} detail={item.reason} value={pc("unban")} onPress={() => serverId && void run(async () => { await serverUseCases.unbanMember(serverId, item.user.id); setBans(await serverUseCases.bans(serverId)); }, false)} />} ListEmptyComponent={<ManagementEmpty text={pc("noItems")} />} /> : null}
    {tab === "audit" ? <FlatList contentContainerStyle={styles.list} data={audit} keyExtractor={(item) => item.id} renderItem={({ item }) => <ManagementRow icon="document-text-outline" label={auditLabel(item.action, language)} detail={new Date(item.createdAt).toLocaleString(language === "ru" ? "ru-RU" : "en-US")} />} ListEmptyComponent={<ManagementEmpty text={pc("noItems")} />} /> : null}
    <TextEntryModal visible={editor !== null} title={editorTitle(editor, pc)} placeholder={editor?.type === "memberSearch" ? "@username" : pc("name")} submitLabel={pc("save")} onClose={() => setEditor(null)} onSubmit={submitEditor} />
    <RolePermissionModal visible={permissionRole !== null} serverId={serverId} role={permissionRole} canDelete={permissions.has("manage_roles")} onClose={() => setPermissionRole(null)} onSaved={() => void load()} />
    <ChannelOverridesModal visible={overrideChannelId !== null} serverId={serverId} channelId={overrideChannelId} roles={roles} members={members} onClose={() => setOverrideChannelId(null)} />
  </ManagementModal>;
}

function RolePermissionModal({ visible, serverId, role, canDelete, onClose, onSaved }: { visible: boolean; serverId: string | null; role: ServerRoleDefinition | null; canDelete: boolean; onClose: () => void; onSaved: () => void }) {
  const { language, t } = useTranslation(); const palette = usePalette(); const showDialog = useAppDialog(); const [permissions, setPermissions] = useState<ServerPermission[]>([]); const [busy, setBusy] = useState(false); const pc = (key: Parameters<typeof productCopy>[1]) => productCopy(language, key);
  useEffect(() => { setPermissions(role?.permissions ?? []); }, [role]);
  const save = async () => { if (!serverId || !role) return; setBusy(true); try { await serverUseCases.updateRole(serverId, role.id, { permissions }); onSaved(); onClose(); } catch (error) { showDialog(pc("operationFailed"), userFacingError(error, t)); } finally { setBusy(false); } };
  const remove = async () => { if (!serverId || !role) return; setBusy(true); try { await serverUseCases.removeRole(serverId, role.id); onSaved(); onClose(); } catch (error) { showDialog(pc("operationFailed"), userFacingError(error, t)); } finally { setBusy(false); } };
  return <ManagementModal visible={visible} title={role?.name ?? pc("permissions")} onClose={onClose} busy={busy} right={<Pressable onPress={() => void save()}><Text style={{ color: palette.accent, fontWeight: "800" }}>{pc("save")}</Text></Pressable>}><FlatList contentContainerStyle={styles.list} data={[...serverPermissionValues]} keyExtractor={(item) => item} renderItem={({ item }) => <View style={[styles.permission, { borderColor: palette.border }]}><Text style={[styles.permissionText, { color: palette.text }]}>{permissionLabel(item, language)}</Text><Switch value={permissions.includes(item)} onValueChange={(active) => setPermissions((items) => active ? [...items, item] : items.filter((value) => value !== item))} trackColor={{ false: palette.border, true: palette.accent }} thumbColor="white" /></View>} ListFooterComponent={canDelete && role && serverId ? <ManagementRow icon="trash-outline" label={pc("delete")} destructive onPress={() => showDialog(pc("delete"), undefined, [{ text: pc("cancel"), style: "cancel" }, { text: pc("delete"), style: "destructive", onPress: () => void remove() }])} /> : null} /></ManagementModal>;
}

function ChannelOverridesModal({ visible, serverId, channelId, roles, members, onClose }: { visible: boolean; serverId: string | null; channelId: string | null; roles: ServerRoleDefinition[]; members: ServerMemberView[]; onClose: () => void }) {
  const { language, t } = useTranslation(); const palette = usePalette(); const showDialog = useAppDialog(); const pc = (key: Parameters<typeof productCopy>[1]) => productCopy(language, key); const [items, setItems] = useState<ChannelPermissionOverride[]>([]); const [target, setTarget] = useState<{ type: ChannelPermissionOverride["targetType"]; id: string; title: string } | null>(null); const [allow, setAllow] = useState<ServerPermission[]>([]); const [deny, setDeny] = useState<ServerPermission[]>([]); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { if (serverId && channelId) setItems(await serverUseCases.overrides(serverId, channelId)); }, [channelId, serverId]); useEffect(() => { if (visible) void load().catch((error) => showDialog(pc("operationFailed"), userFacingError(error, t))); else setTarget(null); }, [load, visible]);
  const open = (type: ChannelPermissionOverride["targetType"], id: string, title: string) => { const item = items.find((value) => value.targetType === type && value.targetId === id); setAllow(item?.allow ?? []); setDeny(item?.deny ?? []); setTarget({ type, id, title }); };
  const cycle = (permission: ServerPermission) => { if (allow.includes(permission)) { setAllow((items) => items.filter((item) => item !== permission)); setDeny((items) => [...items, permission]); } else if (deny.includes(permission)) setDeny((items) => items.filter((item) => item !== permission)); else setAllow((items) => [...items, permission]); };
  const save = async () => { if (!serverId || !channelId || !target) return; setBusy(true); try { if (allow.length || deny.length) await serverUseCases.setOverride(serverId, channelId, target.type, target.id, { allow, deny }); else await serverUseCases.removeOverride(serverId, channelId, target.type, target.id); await load(); setTarget(null); } catch (error) { showDialog(pc("operationFailed"), userFacingError(error, t)); } finally { setBusy(false); } };
  return <ManagementModal visible={visible} title={pc("overrides")} onClose={onClose} busy={busy}><FlatList contentContainerStyle={styles.list} data={[{ type: "everyone" as const, id: serverId ?? "", title: pc("defaultMembers") }, ...roles.map((role) => ({ type: "role" as const, id: role.id, title: role.name })), ...members.filter((member) => member.role !== "owner").map((member) => ({ type: "member" as const, id: member.user.id, title: member.user.displayName }))]} keyExtractor={(item) => `${item.type}-${item.id}`} renderItem={({ item }) => <ManagementRow icon={item.type === "member" ? "person-outline" : "shield-outline"} label={item.title} detail={items.some((value) => value.targetType === item.type && value.targetId === item.id) ? pc("saved") : pc("inherit")} onPress={() => open(item.type, item.id, item.title)} />} /><ManagementModal visible={target !== null} title={target?.title ?? ""} onClose={() => setTarget(null)} busy={busy} right={<Pressable onPress={() => void save()}><Text style={{ color: palette.accent, fontWeight: "800" }}>{pc("save")}</Text></Pressable>}><FlatList contentContainerStyle={styles.list} data={[...serverPermissionValues]} keyExtractor={(item) => item} renderItem={({ item }) => <ManagementRow icon="options-outline" label={permissionLabel(item, language)} value={allow.includes(item) ? pc("permissionAllow") : deny.includes(item) ? pc("permissionDeny") : pc("permissionInherit")} onPress={() => cycle(item)} />} /></ManagementModal></ManagementModal>;
}

function editorTitle(editor: Editor, pc: (key: Parameters<typeof productCopy>[1]) => string) { if (editor?.type === "memberSearch") return pc("addMember"); if (editor?.type === "category") return editor.id ? pc("edit") : pc("addCategory"); if (editor?.type === "channel") return editor.id ? pc("edit") : pc("addChannel"); if (editor?.type === "role") return pc("addRole"); return pc("serverManagement"); }
function memberRoleLabel(role: ServerMemberView["role"], pc: (key: Parameters<typeof productCopy>[1]) => string) { return role === "owner" ? pc("owner") : role === "admin" ? pc("administrator") : role === "moderator" ? pc("moderator") : pc("member"); }
function auditLabel(action: string, language: "ru" | "en") { return language === "ru" ? action.replaceAll(".", " · ") : action.replaceAll(".", " · "); }
function permissionLabel(permission: ServerPermission, language: "ru" | "en") { const ru: Record<ServerPermission, string> = { view_channels: "Просмотр каналов", send_messages: "Отправка сообщений", attach_files: "Прикрепление файлов", add_reactions: "Реакции", manage_messages: "Управление сообщениями", connect: "Подключение к голосу", speak: "Голос", video: "Видео", screen_share: "Демонстрация экрана", move_members: "Перемещение участников", manage_channels: "Управление каналами", manage_categories: "Управление категориями", manage_members: "Управление участниками", kick_members: "Исключение участников", ban_members: "Блокировка участников", manage_roles: "Управление ролями", manage_server: "Управление сервером", view_audit_log: "Просмотр журнала" }; return language === "ru" ? ru[permission] : permission.split("_").map((item) => item[0]!.toUpperCase() + item.slice(1)).join(" "); }

const styles = StyleSheet.create({ tabScroll: { flexGrow: 0 }, tabs: { paddingHorizontal: 10, paddingVertical: 9, gap: 7 }, tab: { minHeight: 34, borderRadius: 10, justifyContent: "center", paddingHorizontal: 13 }, list: { paddingHorizontal: 12, paddingBottom: 28 }, member: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 11, borderBottomWidth: StyleSheet.hairlineWidth }, memberCopy: { flex: 1 }, permission: { minHeight: 56, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12 }, permissionText: { flex: 1, fontSize: 14, fontWeight: "600" } });
