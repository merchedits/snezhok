import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Switch, Text, View } from "react-native";

import type { AppSettings, NotificationPolicy } from "@snezhok/contracts";

import { usePalette } from "../../hooks/usePalette";
import { useTranslation } from "../../i18n";
import { productApi } from "../../lib/productApi";
import { productCopy } from "../../lib/productCopy";
import { userFacingError } from "../../lib/userFacingError";
import { useAppStore } from "../../store/useAppStore";
import { useAppDialog } from "../AppDialogProvider";
import { ManagementEmpty, ManagementModal, ManagementRow, ManagementScroll, ManagementSection } from "./ManagementUi";

type Tab = "global" | "servers" | "streams";
type Target = { kind: "server"; id: string; title: string } | { kind: "stream"; id: string; streamKind: "conversation" | "channel"; title: string };
const inheritedPolicy: NotificationPolicy = { enabled: null, showPreview: null, sound: null, mobile: null, mentionsOnly: null, mutedUntil: null };
const allWeekdays = [0, 1, 2, 3, 4, 5, 6] as const;
const weekdayCopyKeys = ["sundayShort", "mondayShort", "tuesdayShort", "wednesdayShort", "thursdayShort", "fridayShort", "saturdayShort"] as const;

export function NotificationPreferencesModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const palette = usePalette(); const { language, t } = useTranslation(); const showDialog = useAppDialog();
  const settings = useAppStore((state) => state.settings); const updateSettings = useAppStore((state) => state.updateSettings);
  const servers = useAppStore((state) => state.servers); const conversations = useAppStore((state) => state.conversations); const channels = useAppStore((state) => state.channels);
  const [tab, setTab] = useState<Tab>("global"); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [serverPolicies, setServerPolicies] = useState<Record<string, NotificationPolicy>>({});
  const [streamPolicies, setStreamPolicies] = useState<Record<string, NotificationPolicy>>({});
  const [target, setTarget] = useState<Target | null>(null); const [draft, setDraft] = useState<NotificationPolicy>(inheritedPolicy);
  const [timeTarget, setTimeTarget] = useState<"start" | "end" | null>(null);
  const pc = useCallback((key: Parameters<typeof productCopy>[1]) => productCopy(language, key), [language]);

  useEffect(() => { if (!visible) return; setBusy(true); void Promise.all([productApi.serverNotificationPolicies(), productApi.streamNotificationPolicies()]).then(([serverItems, streamItems]) => {
    setServerPolicies(Object.fromEntries(serverItems.map(({ serverId, ...policy }) => [serverId, policy])));
    setStreamPolicies(Object.fromEntries(streamItems.map(({ streamId, streamKind: _kind, ...policy }) => [streamId, policy])));
  }).catch((error) => showDialog(pc("operationFailed"), userFacingError(error, t))).finally(() => setBusy(false)); }, [pc, showDialog, t, visible]);

  const patchGlobal = (patch: Partial<AppSettings>) => {
    if (lock.current) return; lock.current = true;
    void Haptics.selectionAsync().catch(() => undefined);
    void updateSettings(patch).catch((error) => showDialog(pc("operationFailed"), userFacingError(error, t))).finally(() => { lock.current = false; });
  };
  const openPolicy = (next: Target) => { setTarget(next); setDraft({ ...inheritedPolicy, ...(next.kind === "server" ? serverPolicies[next.id] : streamPolicies[next.id]) }); };
  const quietHoursActive = settings.quietHoursStart != null && settings.quietHoursEnd != null;
  const quietHoursDays = settings.quietHoursDays?.length ? settings.quietHoursDays : [...allWeekdays];
  const toggleQuietHoursDay = (day: number) => {
    const selected = quietHoursDays.includes(day);
    if (selected && quietHoursDays.length === 1) return;
    patchGlobal({ quietHoursDays: selected ? quietHoursDays.filter((value) => value !== day) : [...quietHoursDays, day].sort((left, right) => left - right) });
  };

  const savePolicy = async () => {
    if (!target || lock.current) return; lock.current = true; setBusy(true);
    try {
      if (target.kind === "server") { await productApi.setServerNotificationPolicy(target.id, draft); setServerPolicies((items) => ({ ...items, [target.id]: draft })); }
      else { await productApi.setStreamNotificationPolicy(target.id, target.streamKind, draft); setStreamPolicies((items) => ({ ...items, [target.id]: draft })); }
      setTarget(null); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (error) { showDialog(pc("operationFailed"), userFacingError(error, t)); }
    finally { lock.current = false; setBusy(false); }
  };
  const resetPolicy = async () => {
    if (!target || lock.current) return; lock.current = true; setBusy(true);
    try {
      if (target.kind === "server") { await productApi.clearServerNotificationPolicy(target.id); setServerPolicies(({ [target.id]: _removed, ...items }) => items); }
      else { await productApi.clearStreamNotificationPolicy(target.id); setStreamPolicies(({ [target.id]: _removed, ...items }) => items); }
      setTarget(null);
    } catch (error) { showDialog(pc("operationFailed"), userFacingError(error, t)); }
    finally { lock.current = false; setBusy(false); }
  };

  const streamTargets: Target[] = [
    ...conversations.filter((item) => !item.saved).map((item): Target => ({ kind: "stream", id: item.id, streamKind: "conversation", title: item.title })),
    ...channels.map((item): Target => ({ kind: "stream", id: item.id, streamKind: "channel", title: `# ${item.name}` })),
  ];
  return <ManagementModal visible={visible} title={pc("notifications")} onClose={onClose} busy={busy}>
    <View style={[styles.tabs, { backgroundColor: palette.surface }]}>{(["global", "servers", "streams"] as const).map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, { backgroundColor: tab === item ? palette.elevated : "transparent" }]}><Text style={{ color: tab === item ? palette.text : palette.secondaryText, fontWeight: "700", fontSize: 12 }}>{item === "global" ? pc("notifications") : item === "servers" ? pc("serverOverrides") : pc("chatOverrides")}</Text></Pressable>)}</View>
    {tab === "global" && quietHoursActive ? <View style={[styles.timeSummary, { borderColor: palette.border }]}><Pressable onPress={() => setTimeTarget("start")} style={styles.timeSummaryButton}><Text style={[styles.timeSummaryLabel, { color: palette.secondaryText }]}>{pc("quietHoursStart")}</Text><Text style={[styles.timeSummaryValue, { color: palette.accent }]}>{formatMinutes(settings.quietHoursStart ?? 22 * 60)}</Text></Pressable><Pressable onPress={() => setTimeTarget("end")} style={styles.timeSummaryButton}><Text style={[styles.timeSummaryLabel, { color: palette.secondaryText }]}>{pc("quietHoursEnd")}</Text><Text style={[styles.timeSummaryValue, { color: palette.accent }]}>{formatMinutes(settings.quietHoursEnd ?? 8 * 60)}</Text></Pressable></View> : null}
    {tab === "global" ? <ManagementScroll><ManagementSection>
      <ToggleRow label={pc("messages")} value={settings.messageNotifications !== false} onChange={(messageNotifications) => patchGlobal({ messageNotifications })} />
      <ToggleRow label={pc("calls")} value={settings.callNotifications !== false} onChange={(callNotifications) => patchGlobal({ callNotifications })} />
      <ToggleRow label={pc("previews")} value={settings.notificationPreviews !== false} onChange={(notificationPreviews) => patchGlobal({ notificationPreviews })} />
      <ToggleRow label={pc("sound")} value={settings.notificationSound !== false} onChange={(notificationSound) => patchGlobal({ notificationSound })} />
      <ToggleRow label={pc("mobileDelivery")} value={settings.notificationMobile !== false} onChange={(notificationMobile) => patchGlobal({ notificationMobile })} />
      <ToggleRow label={pc("mentionsOnly")} value={settings.notificationMentionsOnly === true} onChange={(notificationMentionsOnly) => patchGlobal({ notificationMentionsOnly })} />
    </ManagementSection><ManagementSection footer={pc("quietHoursHint")}><ToggleRow label={pc("quietHours")} value={quietHoursActive} onChange={(active) => patchGlobal({ quietHoursStart: active ? 22 * 60 : null, quietHoursEnd: active ? 8 * 60 : null, quietHoursTimezoneOffsetMinutes: new Date().getTimezoneOffset(), ...(active && !settings.quietHoursDays?.length ? { quietHoursDays: [...allWeekdays] } : {}) })} />{quietHoursActive ? <View style={[styles.weekdays, { borderColor: palette.border }]}><Text style={[styles.weekdaysLabel, { color: palette.secondaryText }]}>{pc("quietHoursDays")}</Text><View style={styles.weekdayButtons}>{allWeekdays.map((day) => { const selected = quietHoursDays.includes(day); const onlySelected = selected && quietHoursDays.length === 1; return <Pressable key={day} accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: onlySelected }} accessibilityLabel={pc(weekdayCopyKeys[day]!)} disabled={onlySelected} onPress={() => toggleQuietHoursDay(day)} style={[styles.weekday, { backgroundColor: selected ? palette.accent : palette.background, borderColor: selected ? palette.accent : palette.border }]}><Text style={[styles.weekdayText, { color: selected ? "white" : palette.secondaryText }]}>{pc(weekdayCopyKeys[day]!)}</Text></Pressable>; })}</View></View> : null}</ManagementSection></ManagementScroll>
      : <FlatList contentContainerStyle={styles.list} data={tab === "servers" ? servers.map((server): Target => ({ kind: "server", id: server.id, title: server.name })) : streamTargets} keyExtractor={(item) => `${item.kind}-${item.id}`} renderItem={({ item }) => { const policy = item.kind === "server" ? serverPolicies[item.id] : streamPolicies[item.id]; return <ManagementRow icon={item.kind === "server" ? "server-outline" : "chatbubble-outline"} label={item.title} detail={policySummary(policy, pc)} onPress={() => openPolicy(item)} />; }} ListEmptyComponent={<ManagementEmpty text={pc("noItems")} />} />}
    <ManagementModal visible={Boolean(target)} title={target?.title ?? ""} onClose={() => setTarget(null)} busy={busy} right={<Pressable onPress={() => void savePolicy()}><Text style={{ color: palette.accent, fontWeight: "800" }}>{pc("save")}</Text></Pressable>}>
      <ManagementScroll><ManagementSection>
        <TriStateRow label={pc("notifications")} value={draft.enabled} onChange={(enabled) => setDraft((value) => ({ ...value, enabled }))} pc={pc} />
        <TriStateRow label={pc("previews")} value={draft.showPreview} onChange={(showPreview) => setDraft((value) => ({ ...value, showPreview }))} pc={pc} />
        <TriStateRow label={pc("sound")} value={draft.sound} onChange={(sound) => setDraft((value) => ({ ...value, sound }))} pc={pc} />
        <TriStateRow label={pc("mobileDelivery")} value={draft.mobile} onChange={(mobile) => setDraft((value) => ({ ...value, mobile }))} pc={pc} />
        <TriStateRow label={pc("mentionsOnly")} value={draft.mentionsOnly} onChange={(mentionsOnly) => setDraft((value) => ({ ...value, mentionsOnly }))} pc={pc} />
      </ManagementSection><ManagementSection><ManagementRow icon="time-outline" label={pc("muteOneHour")} {...(draft.mutedUntil && draft.mutedUntil > Date.now() ? { value: pc("muted") } : {})} onPress={() => setDraft((value) => ({ ...value, mutedUntil: Date.now() + 3_600_000 }))} /><ManagementRow icon="refresh-outline" label={pc("reset")} destructive onPress={() => void resetPolicy()} /></ManagementSection></ManagementScroll>
    </ManagementModal>
    <ManagementModal visible={timeTarget !== null} title={pc("chooseTime")} onClose={() => setTimeTarget(null)}>
      <View style={styles.timeGrid}>{Array.from({ length: 24 }, (_, hour) => {
        const selected = (timeTarget === "start" ? settings.quietHoursStart : settings.quietHoursEnd) === hour * 60;
        return <Pressable key={hour} onPress={() => { patchGlobal(timeTarget === "start" ? { quietHoursStart: hour * 60, quietHoursTimezoneOffsetMinutes: new Date().getTimezoneOffset() } : { quietHoursEnd: hour * 60, quietHoursTimezoneOffsetMinutes: new Date().getTimezoneOffset() }); setTimeTarget(null); }} style={[styles.timeButton, { backgroundColor: selected ? palette.accent : palette.surface }]}><Text style={{ color: selected ? "white" : palette.text, fontWeight: "700" }}>{`${String(hour).padStart(2, "0")}:00`}</Text></Pressable>;
      })}</View>
    </ManagementModal>
  </ManagementModal>;

  function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) { return <View style={[styles.toggle, { borderColor: palette.border }]}><Text style={[styles.toggleLabel, { color: palette.text }]}>{label}</Text><Switch value={value} onValueChange={onChange} trackColor={{ false: palette.border, true: palette.accent }} thumbColor="white" /></View>; }
}

function TriStateRow({ label, value, onChange, pc }: { label: string; value: boolean | null; onChange: (value: boolean | null) => void; pc: (key: Parameters<typeof productCopy>[1]) => string }) {
  return <ManagementRow icon="options-outline" label={label} value={value === null ? pc("inherit") : value ? pc("enabled") : pc("disabled")} onPress={() => onChange(value === null ? true : value ? false : null)} />;
}
function policySummary(policy: NotificationPolicy | undefined, pc: (key: Parameters<typeof productCopy>[1]) => string) { if (!policy) return pc("inherit"); if (policy.mutedUntil && policy.mutedUntil > Date.now()) return pc("muted"); if (policy.enabled === false) return pc("disabled"); if (policy.mentionsOnly) return pc("mentionsOnly"); return policy.enabled === true ? pc("enabled") : pc("inherit"); }
function formatMinutes(value: number) { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }

const styles = StyleSheet.create({ tabs: { flexDirection: "row", margin: 10, borderRadius: 11, padding: 3 }, tab: { flex: 1, minHeight: 36, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }, timeSummary: { marginHorizontal: 12, marginBottom: 4, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, flexDirection: "row" }, timeSummaryButton: { flex: 1, minHeight: 50, alignItems: "center", justifyContent: "center" }, timeSummaryLabel: { fontSize: 11, fontWeight: "600" }, timeSummaryValue: { fontSize: 15, fontWeight: "800", marginTop: 2 }, timeGrid: { padding: 16, flexDirection: "row", flexWrap: "wrap", gap: 8 }, timeButton: { width: "22%", minHeight: 42, borderRadius: 10, alignItems: "center", justifyContent: "center" }, list: { paddingHorizontal: 12, paddingBottom: 28 }, toggle: { minHeight: 58, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth }, toggleLabel: { flex: 1, fontSize: 15, fontWeight: "600" }, weekdays: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 13, borderBottomWidth: StyleSheet.hairlineWidth }, weekdaysLabel: { marginBottom: 9, fontSize: 12, fontWeight: "600" }, weekdayButtons: { flexDirection: "row", gap: 5 }, weekday: { flex: 1, minWidth: 0, height: 32, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" }, weekdayText: { fontSize: 11, fontWeight: "800" } });
