import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import type { PrivacyAudience, PrivacySettings, SessionDevice, UserSummary } from "@snezhok/contracts";

import { accountUseCases } from "../../application/management/accountUseCases";
import { usePalette } from "../../hooks/usePalette";
import { useTranslation } from "../../i18n";
import { productCopy } from "../../lib/productCopy";
import { userFacingError } from "../../lib/userFacingError";
import { useAppStore } from "../../store/useAppStore";
import { Avatar } from "../Avatar";
import { useAppDialog } from "../AppDialogProvider";
import { ManagementEmpty, ManagementModal, ManagementRow, ManagementScroll, ManagementSection } from "./ManagementUi";

export type AccountPrivacyPage = "account" | "privacy";

export function AccountPrivacyModal({ visible, initialPage, onClose }: { visible: boolean; initialPage: AccountPrivacyPage; onClose: () => void }) {
  const { language, t } = useTranslation();
  const palette = usePalette();
  const showDialog = useAppDialog();
  const friends = useAppStore((state) => state.friends);
  const refresh = useAppStore((state) => state.refreshBootstrap);
  const signOut = useAppStore((state) => state.signOut);
  const [page, setPage] = useState(initialPage);
  const [sessions, setSessions] = useState<SessionDevice[]>([]);
  const [privacy, setPrivacy] = useState<PrivacySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSummary[]>([]);
  const pc = useCallback((key: Parameters<typeof productCopy>[1], values?: Record<string, string | number>) => productCopy(language, key, values), [language]);

  useEffect(() => { if (visible) setPage(initialPage); }, [initialPage, visible]);
  useEffect(() => {
    if (!visible) return;
    setBusy(true);
    void accountUseCases.load().then(({ sessions: nextSessions, privacy: nextPrivacy }) => { setSessions(nextSessions); setPrivacy(nextPrivacy); }).catch((error) => showDialog(pc("operationFailed"), userFacingError(error, t))).finally(() => setBusy(false));
  }, [pc, showDialog, t, visible]);

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await action(); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined); }
    catch (error) { showDialog(pc("operationFailed"), userFacingError(error, t)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const chooseAudience = (key: keyof PrivacySettings, label: string) => {
    if (!privacy) return;
    const options: Array<{ value: PrivacyAudience; label: string }> = [
      { value: "everyone", label: pc("everyone") }, { value: "contacts", label: pc("contactsOnly") }, { value: "nobody", label: pc("nobody") },
    ];
    showDialog(label, undefined, [
      ...options.map((option) => ({ text: `${privacy[key] === option.value ? "✓ " : ""}${option.label}`, onPress: () => {
        const previous = privacy; const next = { ...privacy, [key]: option.value }; setPrivacy(next);
        void accountUseCases.updatePrivacy({ [key]: option.value }).then(setPrivacy).catch((error) => { setPrivacy(previous); showDialog(pc("operationFailed"), userFacingError(error, t)); });
      } })),
      { text: pc("cancel"), style: "cancel" },
    ]);
  };

  const audienceLabel = (value: PrivacyAudience) => value === "everyone" ? pc("everyone") : value === "contacts" ? pc("contactsOnly") : pc("nobody");
  const blocked = friends.filter((entry) => entry.relationship === "blocked");

  return <ManagementModal visible={visible} title={page === "account" ? pc("accountSecurity") : pc("privacyDetails")} onClose={onClose} busy={busy}>
    <View style={[styles.segment, { backgroundColor: palette.surface }]}>
      <Segment label={pc("accountSecurity")} active={page === "account"} onPress={() => setPage("account")} />
      <Segment label={pc("privacyDetails")} active={page === "privacy"} onPress={() => setPage("privacy")} />
    </View>
    {page === "account" ? <ManagementScroll>
      <ManagementSection title={pc("activeSessions")}>
        {sessions.length ? sessions.map((session) => <ManagementRow
          key={session.id}
          icon={session.platform === "android" ? "phone-portrait-outline" : "globe-outline"}
          label={session.label}
          detail={`${session.ipAddress || "—"} · ${new Date(session.lastUsedAt).toLocaleString(language === "ru" ? "ru-RU" : "en-US")}`}
          {...(session.current
            ? { value: pc("currentDevice") }
            : { onPress: () => void run(async () => { await accountUseCases.revokeSession(session.id); setSessions((items) => items.filter((item) => item.id !== session.id)); }) })}
        />) : <ManagementEmpty text={pc("noSessions")} />}
        {sessions.some((session) => !session.current) ? <ManagementRow icon="log-out-outline" label={pc("revokeOthers")} destructive onPress={() => showDialog(pc("revokeOthers"), undefined, [{ text: pc("cancel"), style: "cancel" }, { text: pc("confirm"), style: "destructive", onPress: () => void run(async () => { await accountUseCases.revokeOtherSessions(); setSessions((items) => items.filter((item) => item.current)); }) }])} /> : null}
      </ManagementSection>
      <ManagementSection title={pc("deleteAccount")} footer={pc("deleteAccountWarning")}>
        <ManagementRow icon="trash-outline" label={pc("deleteAccount")} destructive onPress={() => setDeleting(true)} />
      </ManagementSection>
      {deleting ? <View style={[styles.dangerCard, { backgroundColor: palette.surface, borderColor: palette.danger }]}>
        <Text style={[styles.warning, { color: palette.danger }]}>{pc("deleteAccountWarning")}</Text>
        <TextInput secureTextEntry value={password} onChangeText={setPassword} placeholder={pc("enterPassword")} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.background }]} />
        <View style={styles.inlineActions}><Pressable onPress={() => { setDeleting(false); setPassword(""); }} style={styles.textButton}><Text style={{ color: palette.secondaryText }}>{pc("cancel")}</Text></Pressable><Pressable disabled={password.length < 8 || busy} onPress={() => showDialog(pc("deleteAccount"), pc("deleteAccountWarning"), [{ text: pc("cancel"), style: "cancel" }, { text: pc("deletePermanently"), style: "destructive", onPress: () => void run(async () => { await accountUseCases.deleteAccount(password); await signOut(); }) }], { dismissible: false })} style={[styles.deleteButton, { backgroundColor: palette.danger, opacity: password.length < 8 ? 0.45 : 1 }]}><Text style={styles.deleteText}>{pc("deletePermanently")}</Text></Pressable></View>
      </View> : null}
    </ManagementScroll> : <ManagementScroll>
      <ManagementSection>
        <ManagementRow icon="chatbubbles-outline" label={pc("directMessages")} value={privacy ? audienceLabel(privacy.directMessages) : "—"} onPress={() => chooseAudience("directMessages", pc("directMessages"))} />
        <ManagementRow icon="person-add-outline" label={pc("groupInvites")} value={privacy ? audienceLabel(privacy.groupInvites) : "—"} onPress={() => chooseAudience("groupInvites", pc("groupInvites"))} />
        <ManagementRow icon="images-outline" label={pc("profilePhotosPrivacy")} value={privacy ? audienceLabel(privacy.profilePhotos) : "—"} onPress={() => chooseAudience("profilePhotos", pc("profilePhotosPrivacy"))} />
      </ManagementSection>
      <ManagementSection title={pc("blockedUsers")}>
        {blocked.length ? blocked.map((entry) => <ManagementRow key={entry.user.id} icon="person-remove-outline" label={entry.user.displayName} detail={`@${entry.user.username}`} value={pc("unblock")} onPress={() => void run(async () => { await accountUseCases.unblockUser(entry.user.id); await refresh({ force: true }); })} />) : <ManagementEmpty text={pc("noBlockedUsers")} />}
        <ManagementRow icon="person-add-outline" label={pc("block")} onPress={() => setBlocking(true)} />
      </ManagementSection>
      {blocking ? <View style={styles.searchBlock}><View style={[styles.searchBox, { backgroundColor: palette.surface }]}><TextInput autoCapitalize="none" value={query} onChangeText={setQuery} placeholder={pc("search")} placeholderTextColor={palette.faintText} style={[styles.searchInput, { color: palette.text }]} /><Pressable onPress={() => void run(async () => setResults(await accountUseCases.searchUsers(query)))}><Text style={{ color: palette.accent }}>{pc("search")}</Text></Pressable></View><FlatList scrollEnabled={false} data={results} keyExtractor={(item) => item.id} renderItem={({ item }) => <Pressable onPress={() => void run(async () => { await accountUseCases.blockUser(item.id); await refresh({ force: true }); setBlocking(false); setResults([]); setQuery(""); })} style={styles.userRow}><Avatar uri={item.avatarUrl} label={item.displayName} color={item.avatarColor} size={42} /><View><Text style={{ color: palette.text, fontWeight: "700" }}>{item.displayName}</Text><Text style={{ color: palette.secondaryText }}>@{item.username}</Text></View></Pressable>} /></View> : null}
    </ManagementScroll>}
  </ManagementModal>;

  function Segment({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.segmentItem, { backgroundColor: active ? palette.elevated : "transparent" }]}><Text numberOfLines={1} style={{ color: active ? palette.text : palette.secondaryText, fontWeight: "700", fontSize: 13 }}>{label}</Text></Pressable>; }
}

const styles = StyleSheet.create({
  segment: { flexDirection: "row", margin: 10, borderRadius: 11, padding: 3 }, segmentItem: { flex: 1, minHeight: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  dangerCard: { margin: 12, borderWidth: 1, borderRadius: 14, padding: 14 }, warning: { fontSize: 13, lineHeight: 18, fontWeight: "600" }, input: { height: 46, borderWidth: 1, borderRadius: 10, marginTop: 12, paddingHorizontal: 12 }, inlineActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 12 }, textButton: { height: 42, justifyContent: "center", paddingHorizontal: 12 }, deleteButton: { minHeight: 42, borderRadius: 10, justifyContent: "center", paddingHorizontal: 14 }, deleteText: { color: "white", fontWeight: "800" },
  searchBlock: { marginHorizontal: 12, marginBottom: 20 }, searchBox: { height: 44, flexDirection: "row", alignItems: "center", borderRadius: 11, paddingHorizontal: 12, gap: 8 }, searchInput: { flex: 1 }, userRow: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 8 },
});
