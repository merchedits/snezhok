import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { usePalette } from "../../hooks/usePalette";
import { useTranslation } from "../../i18n";
import { api, ApiError, type AdminMember, type AdminSettings, type GlobalPermission, type GlobalPermissions } from "../../lib/api";
import { userFacingError } from "../../lib/userFacingError";
import { useAppStore } from "../../store/useAppStore";
import { AppIcon } from "../AppIcon";
import { useAppDialog } from "../AppDialogProvider";
import { ManagementEmpty, ManagementModal, ManagementRow, ManagementScroll, ManagementSection } from "./ManagementUi";

const permissionNames: GlobalPermission[] = ["createServers", "createGroups", "uploadFiles", "startCalls"];

export function GlobalAdminModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const palette = usePalette();
  const { language, t } = useTranslation();
  const showDialog = useAppDialog();
  const currentUserId = useAppStore((state) => state.me?.id);
  const ru = language === "ru";
  const [page, setPage] = useState<"settings" | "members">("settings");
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminMember | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [quotaGb, setQuotaGb] = useState("");
  const [uploadMb, setUploadMb] = useState("");
  const [messagesDays, setMessagesDays] = useState("");
  const [mediaDays, setMediaDays] = useState("");
  const [eventsDays, setEventsDays] = useState("");
  const [memberQuotaGb, setMemberQuotaGb] = useState("");

  const copy = useCallback((russian: string, english: string) => ru ? russian : english, [ru]);
  const load = useCallback(async () => {
    const [nextSettings, memberPage] = await Promise.all([api.adminSettings(), api.adminMembers()]);
    setSettings(nextSettings); setMembers(memberPage.items); setNextCursor(memberPage.nextCursor);
    setQuotaGb(formatUnit(nextSettings.defaultStorageQuotaBytes, GB));
    setUploadMb(formatUnit(nextSettings.maxUploadBytes, MB));
    setMessagesDays(nextSettings.messageRetentionDays?.toString() ?? "");
    setMediaDays(String(nextSettings.orphanMediaRetentionDays)); setEventsDays(String(nextSettings.eventRetentionDays));
  }, []);

  useEffect(() => {
    if (!visible) return;
    setPage("settings"); setSelected(null); setSearch(""); setBusy(true);
    void load().catch((error) => showDialog(copy("Не удалось открыть управление", "Could not open administration"), userFacingError(error, t))).finally(() => setBusy(false));
  }, [copy, load, showDialog, t, visible]);

  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await action(); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined); }
    catch (error) { showDialog(copy("Операция не выполнена", "Operation failed"), userFacingError(error, t)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const saveSettings = () => void run(async () => {
    if (!settings) return;
    try {
      const next = await api.updateAdminSettings({
        revision: settings.revision,
        defaultPermissions: settings.defaultPermissions,
        defaultStorageQuotaBytes: parseUnit(quotaGb, GB, copy("Квота", "Quota")),
        maxUploadBytes: parseUnit(uploadMb, MB, copy("Размер файла", "File size")),
        messageRetentionDays: messagesDays.trim() ? parseDays(messagesDays, copy("Сообщения", "Messages")) : null,
        orphanMediaRetentionDays: parseDays(mediaDays, copy("Медиа", "Media")),
        eventRetentionDays: parseDays(eventsDays, copy("События", "Events")),
      });
      setSettings(next);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await load();
      throw error;
    }
  });

  const openMember = (member: AdminMember) => {
    setSelected(member);
    setMemberQuotaGb(member.storageQuotaBytes === null ? "" : formatUnit(member.storageQuotaBytes, GB));
  };
  const saveMember = () => void run(async () => {
    if (!selected) return;
    const next = await api.updateAdminMember(selected.id, {
      isAdmin: selected.isAdmin,
      suspended: selected.suspended,
      permissionOverrides: Object.fromEntries(permissionNames.map((name) => [name, selected.permissionOverrides[name] ?? null])),
      storageQuotaBytes: memberQuotaGb.trim() ? parseUnit(memberQuotaGb, GB, copy("Квота", "Quota")) : null,
    });
    setMembers((items) => items.map((item) => item.id === next.id ? next : item)); setSelected(next);
  });
  const searchMembers = () => void run(async () => { const page = await api.adminMembers(search.trim()); setMembers(page.items); setNextCursor(page.nextCursor); });
  const loadMoreMembers = () => void run(async () => { if (!nextCursor) return; const page = await api.adminMembers(search.trim(), nextCursor); setMembers((items) => [...items, ...page.items.filter((member) => !items.some((item) => item.id === member.id))]); setNextCursor(page.nextCursor); });

  return <ManagementModal visible={visible} title={copy("Управление", "Administration")} onClose={onClose} busy={busy} right={<Pressable accessibilityRole="button" accessibilityLabel={copy("Сохранить", "Save")} onPress={page === "settings" ? saveSettings : selected ? saveMember : undefined} style={styles.headerAction}>{page === "settings" || selected ? <AppIcon name="checkmark" size={22} color={palette.accent} /> : null}</Pressable>}>
    <View style={[styles.segment, { backgroundColor: palette.surface }]}>
      <Segment label={copy("Политики", "Policies")} active={page === "settings"} onPress={() => { setPage("settings"); setSelected(null); }} />
      <Segment label={copy("Участники", "Members")} active={page === "members"} onPress={() => setPage("members")} />
    </View>
    {page === "settings" ? <ManagementScroll>
      <ManagementSection title={copy("Разрешения по умолчанию", "Default permissions")} footer={copy("Администраторы всегда имеют полный доступ. Индивидуальные исключения настраиваются в карточке участника.", "Administrators always have full access. Per-member exceptions are configured on the member card.")}>
        {settings ? permissionNames.map((name) => <PermissionSwitch key={name} label={permissionLabel(name, ru)} value={settings.defaultPermissions[name]} onChange={(value) => setSettings({ ...settings, defaultPermissions: { ...settings.defaultPermissions, [name]: value } })} />) : <ManagementEmpty text={copy("Загрузка…", "Loading…")} />}
      </ManagementSection>
      <ManagementSection title={copy("Хранилище", "Storage")}>
        <NumberField label={copy("Квота участника", "Member quota")} value={quotaGb} onChange={setQuotaGb} suffix="GB" />
        <NumberField label={copy("Максимум на файл", "Maximum file size")} value={uploadMb} onChange={setUploadMb} suffix="MB" />
      </ManagementSection>
      <ManagementSection title={copy("Срок хранения", "Retention")} footer={copy("Пустое поле сообщений означает бессрочное хранение. Удаление выполняется пакетами в фоновом обслуживании.", "An empty message field means indefinite retention. Deletion runs in bounded background batches.")}>
        <NumberField label={copy("Сообщения", "Messages")} value={messagesDays} onChange={setMessagesDays} suffix={copy("дн.", "days")} optional />
        <NumberField label={copy("Неиспользуемые медиа", "Orphaned media")} value={mediaDays} onChange={setMediaDays} suffix={copy("дн.", "days")} />
        <NumberField label={copy("События синхронизации", "Sync events")} value={eventsDays} onChange={setEventsDays} suffix={copy("дн.", "days")} />
      </ManagementSection>
    </ManagementScroll> : selected ? <ManagementScroll>
      <ManagementSection title={`@${selected.username}`}>
        <ManagementRow icon="person-outline" label={selected.displayName} detail={copy(`Использовано ${formatBytes(selected.storageUsedBytes)}`, `${formatBytes(selected.storageUsedBytes)} used`)} />
        <PermissionSwitch label={copy("Глобальный администратор", "Global administrator")} value={selected.isAdmin} onChange={(value) => setSelected({ ...selected, isAdmin: value })} disabled={selected.id === currentUserId} />
        <PermissionSwitch label={copy("Учётная запись приостановлена", "Account suspended")} value={selected.suspended} onChange={(value) => setSelected({ ...selected, suspended: value })} danger disabled={selected.id === currentUserId} />
      </ManagementSection>
      <ManagementSection title={copy("Индивидуальные разрешения", "Member permissions")} footer={copy("Нажмите строку, чтобы переключить: по умолчанию → разрешено → запрещено.", "Tap a row to cycle: default → allowed → denied.")}>
        {permissionNames.map((name) => <OverrideRow key={name} label={permissionLabel(name, ru)} value={selected.permissionOverrides[name]} defaultValue={settings?.defaultPermissions[name] ?? true} onChange={(value) => setSelected({ ...selected, permissionOverrides: { ...selected.permissionOverrides, [name]: value } })} />)}
      </ManagementSection>
      <ManagementSection title={copy("Хранилище", "Storage")} footer={copy("Оставьте пустым, чтобы использовать глобальную квоту.", "Leave empty to use the global quota.")}>
        <NumberField label={copy("Личная квота", "Personal quota")} value={memberQuotaGb} onChange={setMemberQuotaGb} suffix="GB" optional />
      </ManagementSection>
    </ManagementScroll> : <ManagementScroll>
      <ManagementSection>
        <View style={styles.searchRow}><TextInput value={search} onChangeText={setSearch} onSubmitEditing={searchMembers} returnKeyType="search" placeholder={copy("Поиск", "Search")} placeholderTextColor={palette.faintText} style={[styles.search, { color: palette.text, backgroundColor: palette.background, borderColor: palette.border }]} /><Pressable accessibilityRole="button" onPress={searchMembers} style={[styles.searchButton, { backgroundColor: palette.accent }]}><AppIcon name="search" size={19} color="#fff" /></Pressable></View>
      </ManagementSection>
      <ManagementSection title={copy("Аккаунты", "Accounts")}>
        {members.length ? <>{members.map((member) => <ManagementRow key={member.id} icon={member.suspended ? "ban-outline" : member.isAdmin ? "shield-checkmark-outline" : "person-outline"} label={member.displayName} detail={`@${member.username}`} value={member.suspended ? copy("Пауза", "Suspended") : member.isAdmin ? copy("Админ", "Admin") : formatBytes(member.storageUsedBytes)} onPress={() => openMember(member)} />)}{nextCursor ? <ManagementRow icon="refresh-outline" label={copy("Загрузить ещё", "Load more")} onPress={loadMoreMembers} /> : null}</> : <ManagementEmpty text={copy("Ничего не найдено", "Nothing found")} />}
      </ManagementSection>
    </ManagementScroll>}
  </ManagementModal>;
}

function Segment({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) { const palette = usePalette(); return <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.segmentItem, active && { backgroundColor: palette.accentSoft }]}><Text style={{ color: active ? palette.accent : palette.secondaryText, fontWeight: "700" }}>{label}</Text></Pressable>; }
function PermissionSwitch({ label, value, onChange, danger = false, disabled = false }: { label: string; value: boolean; onChange: (value: boolean) => void; danger?: boolean; disabled?: boolean }) { const palette = usePalette(); return <Pressable accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} disabled={disabled} onPress={() => onChange(!value)} style={[styles.row, { borderColor: palette.border, opacity: disabled ? 0.5 : 1 }]}><Text style={[styles.rowLabel, { color: danger ? palette.danger : palette.text }]}>{label}</Text><View pointerEvents="none"><Switch value={value} onValueChange={onChange} trackColor={{ false: palette.border, true: danger ? palette.danger : palette.accent }} thumbColor="#fff" disabled={disabled} /></View></Pressable>; }
function OverrideRow({ label, value, defaultValue, onChange }: { label: string; value: boolean | undefined; defaultValue: boolean; onChange: (value: boolean | undefined) => void }) { const palette = usePalette(); const shown = value === undefined ? defaultValue : value; const cycle = () => onChange(value === undefined ? true : value ? false : undefined); return <Pressable accessibilityRole="button" onPress={cycle} style={[styles.row, { borderColor: palette.border }]}><Text style={[styles.rowLabel, { color: palette.text }]}>{label}</Text><Text style={{ color: value === undefined ? palette.secondaryText : shown ? palette.success : palette.danger, fontWeight: "700" }}>{value === undefined ? "—" : shown ? "✓" : "×"}</Text></Pressable>; }
function NumberField({ label, value, onChange, suffix, optional = false }: { label: string; value: string; onChange: (value: string) => void; suffix: string; optional?: boolean }) { const palette = usePalette(); return <View style={[styles.row, { borderColor: palette.border }]}><Text style={[styles.rowLabel, { color: palette.text }]}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={(text) => onChange(text.replace(/[^0-9.,]/g, ""))} keyboardType="decimal-pad" placeholder={optional ? "—" : "0"} placeholderTextColor={palette.faintText} style={[styles.number, { color: palette.text, borderColor: palette.border, backgroundColor: palette.background }]} /><Text style={{ color: palette.secondaryText }}>{suffix}</Text></View>; }

const MB = 1024 * 1024; const GB = 1024 * MB;
function formatUnit(bytes: number, unit: number) { return (bytes / unit).toFixed(bytes % unit === 0 ? 0 : 1); }
function parseUnit(value: string, unit: number, label: string) { const parsed = Number(value.replace(",", ".")); if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label}: invalid value`); return Math.round(parsed * unit); }
function parseDays(value: string, label: string) { const parsed = Number(value); if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) throw new Error(`${label}: 1–3650`); return parsed; }
function formatBytes(bytes: number) { if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`; if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`; return `${Math.round(bytes / 1024)} KB`; }
function permissionLabel(name: GlobalPermission, ru: boolean) { const labels: Record<GlobalPermission, [string, string]> = { createServers: ["Создание серверов", "Create servers"], createGroups: ["Создание групп", "Create groups"], uploadFiles: ["Загрузка файлов", "Upload files"], startCalls: ["Начало звонков", "Start calls"] }; return labels[name][ru ? 0 : 1]; }

const styles = StyleSheet.create({
  headerAction: { width: 54, height: 54, alignItems: "center", justifyContent: "center" }, segment: { margin: 10, padding: 3, borderRadius: 12, flexDirection: "row" }, segmentItem: { flex: 1, minHeight: 38, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth }, rowLabel: { flex: 1, fontSize: 14, fontWeight: "600" }, number: { width: 82, height: 38, borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, paddingHorizontal: 9, textAlign: "right", fontSize: 14 },
  searchRow: { flexDirection: "row", gap: 8, padding: 10 }, search: { flex: 1, height: 42, borderWidth: StyleSheet.hairlineWidth, borderRadius: 11, paddingHorizontal: 12 }, searchButton: { width: 42, height: 42, borderRadius: 11, alignItems: "center", justifyContent: "center" },
});
