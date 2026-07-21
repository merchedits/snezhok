import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Accessibility,
  Bell,
  Database,
  Gauge,
  Globe2,
  Headphones,
  LogOut,
  Monitor,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import type { AppSettings, SessionDevice, UserSummary } from "@snezhok/contracts";
import { api } from "../lib/api.js";
import { useApp } from "../state/AppContext.js";
import { Avatar, ConfirmDialog, IconButton, Toggle } from "./ui.js";

type Section = "profile" | "account" | "privacy" | "notifications" | "storage" | "appearance" | "voice" | "accessibility" | "language" | "advanced" | "admin";

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "profile", label: "Profile", icon: <UserRound /> },
  { id: "account", label: "Account", icon: <Shield /> },
  { id: "privacy", label: "Privacy and safety", icon: <ShieldCheck /> },
  { id: "notifications", label: "Notifications and sounds", icon: <Bell /> },
  { id: "storage", label: "Data and storage", icon: <Database /> },
  { id: "appearance", label: "Appearance", icon: <Monitor /> },
  { id: "voice", label: "Voice and video", icon: <Headphones /> },
  { id: "accessibility", label: "Accessibility", icon: <Accessibility /> },
  { id: "language", label: "Language", icon: <Globe2 /> },
  { id: "advanced", label: "Advanced", icon: <Gauge /> },
];

export function Settings() {
  const app = useApp();
  const [section, setSection] = useState<Section | null>(() => window.matchMedia("(max-width: 767px)").matches ? null : "profile");
  const [query, setQuery] = useState("");
  const isAdmin = Boolean((app.me as UserSummary & { isAdmin?: boolean } | null)?.isAdmin);
  const canAdmin = isAdmin || Boolean(app.me && app.bootstrap?.servers.some((server) => server.ownerId === app.me?.id));
  const sections = useMemo(() => [...SECTIONS, ...(canAdmin ? [{ id: "admin" as const, label: "Administration", icon: <ShieldCheck /> }] : [])].filter((item) => item.label.toLowerCase().includes(query.toLowerCase())), [canAdmin, query]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") app.setSettingsOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [app]);

  return (
    <div className={`settings-screen ${section ? "has-page" : ""}`} role="dialog" aria-modal="true" aria-label="Settings">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-inner">
          <IconButton label="Close settings" className="settings-mobile-close" onClick={() => app.setSettingsOpen(false)}><X /></IconButton>
          <label className="settings-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search settings" /></label>
          <nav>{sections.map((item) => <button key={item.id} className={section === item.id ? "is-selected" : ""} onClick={() => setSection(item.id)}>{item.icon}{item.label}</button>)}</nav>
          <button className="settings-logout" onClick={() => void app.logout()}><LogOut /> Sign out</button>
        </div>
      </aside>
      <main className="settings-content">
        <button className="settings-back" onClick={() => setSection(null)}>Back</button>
        <IconButton label="Close settings" className="settings-close" onClick={() => app.setSettingsOpen(false)}><X /></IconButton>
        {section === "profile" && <ProfileSettings />}
        {section === "account" && <AccountSettings />}
        {section === "privacy" && <PrivacySettings />}
        {section === "notifications" && <NotificationSettings />}
        {section === "storage" && <StorageSettings />}
        {section === "appearance" && <AppearanceSettings />}
        {section === "voice" && <VoiceSettings />}
        {section === "accessibility" && <AccessibilitySettings />}
        {section === "language" && <LanguageSettings />}
        {section === "advanced" && <AdvancedSettings />}
        {section === "admin" && canAdmin && <AdminSettings />}
      </main>
    </div>
  );
}

function SettingsPage({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="settings-page"><h1>{title}</h1>{children}</div>;
}

function SettingRow({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <div className="setting-row"><span><strong>{title}</strong>{description && <small>{description}</small>}</span><div>{children}</div></div>;
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="settings-group"><h2>{title}</h2>{children}</section>;
}

function ProfileSettings() {
  const app = useApp();
  const me = app.me!;
  const [displayName, setDisplayName] = useState(me.displayName);
  const [statusText, setStatusText] = useState(me.statusText);
  const [bio, setBio] = useState(me.bio);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    await app.updateProfile({ displayName: displayName.trim(), statusText: statusText.trim(), bio: bio.trim() });
  };
  return <SettingsPage title="Profile"><div className="profile-summary"><Avatar user={me} size={80} /><span><strong>{me.displayName}</strong><small>@{me.username}</small></span></div><form className="settings-form" onSubmit={save}><label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={48} required /></label><label>Status<input value={statusText} onChange={(event) => setStatusText(event.target.value)} maxLength={80} /></label><label>Bio<textarea value={bio} onChange={(event) => setBio(event.target.value)} maxLength={190} rows={4} /></label><button className="button button-primary">Save profile</button></form></SettingsPage>;
}

function AccountSettings() {
  const app = useApp();
  const [sessions, setSessions] = useState<SessionDevice[]>([]);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<SessionDevice | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { api.settings.sessions().then((result) => setSessions(result.sessions)).catch(() => undefined); }, []);
  const revoke = async (session: SessionDevice) => {
    await api.settings.revokeSession(session.id);
    setSessions((current) => current.filter((item) => item.id !== session.id));
    setRevokeTarget(null);
  };
  const removeAccount = async (event: FormEvent) => {
    event.preventDefault();
    if (password) setConfirmDelete(true);
  };
  const deleteConfirmed = async () => {
    setConfirmDelete(false);
    setDeleting(true);
    try { await api.deleteAccount(password); await app.logout().catch(() => undefined); }
    catch (error) { app.announce(error instanceof Error ? error.message : "Account deletion failed."); }
    finally { setDeleting(false); }
  };
  return <SettingsPage title="Account"><SettingsGroup title="Devices and sessions">{sessions.map((session) => <div className="session-row" key={session.id}><Monitor /><span><strong>{session.label}{session.current ? " (current)" : ""}</strong><small>{session.platform} · {session.ipAddress}</small></span>{!session.current && <button className="text-button danger-text" onClick={() => setRevokeTarget(session)}>Sign out</button>}</div>)}</SettingsGroup><SettingsGroup title="Danger zone"><form className="settings-form" onSubmit={removeAccount}><label>Confirm with password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button className="button button-danger" disabled={deleting}><Trash2 /> {deleting ? "Deleting…" : "Delete account"}</button></form></SettingsGroup>{revokeTarget && <ConfirmDialog title="Sign out device" body={`Sign out ${revokeTarget.label}?`} confirmLabel="Sign out" destructive onCancel={() => setRevokeTarget(null)} onConfirm={() => void revoke(revokeTarget)} />}{confirmDelete && <ConfirmDialog title="Delete account" body="Permanently delete your account and all active sessions?" confirmLabel="Delete account" destructive onCancel={() => setConfirmDelete(false)} onConfirm={() => void deleteConfirmed()} />}</SettingsPage>;
}

function PrivacySettings() {
  const app = useApp();
  const settings = app.bootstrap!.settings;
  const blocked = app.bootstrap!.friends.filter((entry) => entry.relationship === "blocked");
  const unblock = async (userId: string) => {
    try { await api.unblockUser(userId); app.removeFriendEntry(userId); app.announce("User unblocked."); }
    catch (error) { app.announce(error instanceof Error ? error.message : "Could not unblock user."); }
  };
  return <SettingsPage title="Privacy and safety"><SettingsGroup title="Activity"><SettingRow title="Read receipts" description="Let people know when you have read a message."><Toggle label="Read receipts" checked={settings.readReceipts} onChange={(value) => void app.updateSettings({ readReceipts: value })} /></SettingRow><SettingRow title="Show last seen" description="Friends can see when you were last active."><Toggle label="Show last seen" checked={settings.showLastSeen} onChange={(value) => void app.updateSettings({ showLastSeen: value })} /></SettingRow></SettingsGroup><SettingsGroup title="Media"><SettingRow title="Strip location metadata" description="Remove embedded GPS data from compressed photos and videos."><Toggle label="Strip location metadata" checked={settings.stripMediaLocation} onChange={(value) => void app.updateSettings({ stripMediaLocation: value })} /></SettingRow></SettingsGroup><SettingsGroup title="Blocked users">{blocked.length ? blocked.map((entry) => <div className="session-row" key={entry.user.id}><Avatar user={entry.user} size={36} /><span><strong>{entry.user.displayName}</strong><small>@{entry.user.username}</small></span><button className="button button-secondary" onClick={() => void unblock(entry.user.id)}>Unblock</button></div>) : <p className="settings-note">You have not blocked anyone.</p>}</SettingsGroup></SettingsPage>;
}

function NotificationSettings() {
  const app = useApp();
  const settings = app.bootstrap!.settings;
  const enabled = settings.quietHoursStart != null && settings.quietHoursEnd != null;
  const updateQuiet = (patch: Partial<AppSettings>) => void app.updateSettings(patch);
  return <SettingsPage title="Notifications"><SettingsGroup title="Quiet hours"><SettingRow title="Enable schedule" description="Suppress message notifications during this local-time window."><Toggle label="Quiet hours" checked={enabled} onChange={(value) => updateQuiet(value ? { quietHoursStart: 1320, quietHoursEnd: 480, quietHoursTimezoneOffsetMinutes: new Date().getTimezoneOffset(), quietHoursDays: [0, 1, 2, 3, 4, 5, 6] } : { quietHoursStart: null, quietHoursEnd: null })} /></SettingRow>{enabled && <><SettingRow title="Starts"><input type="time" aria-label="Quiet hours start" value={minutesToTime(settings.quietHoursStart ?? 1320)} onChange={(event) => updateQuiet({ quietHoursStart: timeToMinutes(event.target.value), quietHoursTimezoneOffsetMinutes: new Date().getTimezoneOffset() })} /></SettingRow><SettingRow title="Ends"><input type="time" aria-label="Quiet hours end" value={minutesToTime(settings.quietHoursEnd ?? 480)} onChange={(event) => updateQuiet({ quietHoursEnd: timeToMinutes(event.target.value), quietHoursTimezoneOffsetMinutes: new Date().getTimezoneOffset() })} /></SettingRow><div className="quiet-days">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, index) => { const days = settings.quietHoursDays ?? [0, 1, 2, 3, 4, 5, 6]; return <label key={day}><input type="checkbox" checked={days.includes(index)} onChange={(event) => { const next = event.target.checked ? [...days, index] : days.filter((value) => value !== index); if (next.length) updateQuiet({ quietHoursDays: next.sort() }); }} />{day}</label>; })}</div></>}</SettingsGroup></SettingsPage>;
}

function StorageSettings() {
  const app = useApp();
  const settings = app.bootstrap!.settings;
  return <SettingsPage title="Data and storage"><SettingsGroup title="Upload"><SettingRow title="Default media quality"><select value={settings.defaultUploadQuality} onChange={(event) => void app.updateSettings({ defaultUploadQuality: event.target.value as AppSettings["defaultUploadQuality"] })}><option value="data-saver">Data saver</option><option value="auto">Auto</option><option value="high">High quality</option><option value="original">Original</option></select></SettingRow></SettingsGroup><SettingsGroup title="Automatic download"><SettingRow title="Wi-Fi"><Toggle label="Auto-download on Wi-Fi" checked={settings.autoDownloadWifi} onChange={(value) => void app.updateSettings({ autoDownloadWifi: value })} /></SettingRow><SettingRow title="Mobile data"><Toggle label="Auto-download on mobile data" checked={settings.autoDownloadMobile} onChange={(value) => void app.updateSettings({ autoDownloadMobile: value })} /></SettingRow></SettingsGroup><SettingsGroup title="Cache"><SettingRow title="Local message cache" description="Recent messages, drafts, and queued sends are stored in this browser."><button className="button button-secondary" onClick={() => void app.clearOfflineCache()}>Clear offline data</button></SettingRow></SettingsGroup></SettingsPage>;
}

function AppearanceSettings() {
  const app = useApp();
  const settings = app.bootstrap!.settings;
  return <SettingsPage title="Appearance"><SettingsGroup title="Theme"><SettingRow title="Color theme"><select value={settings.theme} onChange={(event) => void app.updateSettings({ theme: event.target.value as AppSettings["theme"] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></SettingRow><SettingRow title="Accent"><select value={settings.accent} onChange={(event) => void app.updateSettings({ accent: event.target.value as AppSettings["accent"] })}><option value="blue">Blue</option><option value="green">Green</option><option value="purple">Purple</option><option value="orange">Orange</option><option value="red">Red</option></select></SettingRow></SettingsGroup><SettingsGroup title="Messages"><SettingRow title="Text size"><input type="range" min={0.85} max={1.3} step={0.05} value={settings.fontScale} onChange={(event) => void app.updateSettings({ fontScale: Number(event.target.value) })} aria-label="Text size" /></SettingRow><SettingRow title="Density"><select value={settings.density} onChange={(event) => void app.updateSettings({ density: event.target.value as AppSettings["density"] })}><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></SettingRow><SettingRow title="Bubble radius"><input type="range" min={6} max={20} value={settings.bubbleRadius} onChange={(event) => void app.updateSettings({ bubbleRadius: Number(event.target.value) })} aria-label="Bubble radius" /></SettingRow></SettingsGroup></SettingsPage>;
}

function VoiceSettings() {
  const app = useApp();
  const settings = app.bootstrap!.settings;
  return <SettingsPage title="Voice and video"><SettingsGroup title="Processing"><SettingRow title="Noise suppression"><select value={settings.noiseSuppression} onChange={(event) => void app.updateSettings({ noiseSuppression: event.target.value as AppSettings["noiseSuppression"] })}><option value="off">Off</option><option value="standard">Standard</option><option value="high">High</option></select></SettingRow><SettingRow title="Echo cancellation"><Toggle label="Echo cancellation" checked={settings.echoCancellation} onChange={(value) => void app.updateSettings({ echoCancellation: value })} /></SettingRow><SettingRow title="Automatic gain control"><Toggle label="Automatic gain control" checked={settings.autoGainControl} onChange={(value) => void app.updateSettings({ autoGainControl: value })} /></SettingRow></SettingsGroup></SettingsPage>;
}

function AccessibilitySettings() {
  const app = useApp();
  const settings = app.bootstrap!.settings;
  return <SettingsPage title="Accessibility"><SettingsGroup title="Display"><SettingRow title="Reduced motion"><Toggle label="Reduced motion" checked={settings.reducedMotion} onChange={(value) => void app.updateSettings({ reducedMotion: value })} /></SettingRow><SettingRow title="Higher contrast"><Toggle label="Higher contrast" checked={settings.highContrast} onChange={(value) => void app.updateSettings({ highContrast: value })} /></SettingRow></SettingsGroup></SettingsPage>;
}

function LanguageSettings() {
  const app = useApp();
  return <SettingsPage title="Language"><SettingsGroup title="Application language"><label className="radio-row"><input type="radio" checked={app.bootstrap!.settings.language === "en"} onChange={() => void app.updateSettings({ language: "en" })} /> English</label><label className="radio-row"><input type="radio" checked={app.bootstrap!.settings.language === "ru"} onChange={() => void app.updateSettings({ language: "ru" })} /> Русский</label></SettingsGroup></SettingsPage>;
}

function AdvancedSettings() {
  const app = useApp();
  return <SettingsPage title="Advanced"><SettingsGroup title="Diagnostics"><button className="button button-secondary" onClick={() => {
    const data = JSON.stringify({ online: app.online, realtime: app.socketConnected, userAgent: navigator.userAgent, time: new Date().toISOString() }, null, 2);
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([data], { type: "application/json" })); link.download = "snezhok-diagnostics.json"; link.click(); URL.revokeObjectURL(link.href);
  }}>Export diagnostics</button></SettingsGroup></SettingsPage>;
}

function AdminSettings() {
  const app = useApp();
  const announce = app.announce;
  const servers = app.bootstrap!.servers.filter((server) => server.ownerId === app.me?.id);
  const [serverId, setServerId] = useState(servers[0]?.id ?? "");
  const [members, setMembers] = useState<Array<{ user: UserSummary; role: "owner" | "admin" | "moderator" | "member" }>>([]);
  const [loading, setLoading] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<{ user: UserSummary; role: string } | null>(null);
  useEffect(() => {
    if (!serverId) { setMembers([]); return; }
    setLoading(true);
    api.serverMembers(serverId).then((result) => setMembers(result.members)).catch((error) => announce(error instanceof Error ? error.message : "Could not load members.")).finally(() => setLoading(false));
  }, [announce, serverId]);
  const remove = async (member: { user: UserSummary; role: string }) => {
    try { await api.removeServerMember(serverId, member.user.id); setMembers((current) => current.filter((item) => item.user.id !== member.user.id)); app.announce("Member removed."); }
    catch (error) { app.announce(error instanceof Error ? error.message : "Could not remove member."); }
    finally { setRemoveTarget(null); }
  };
  return <SettingsPage title="Administration"><SettingsGroup title="Server members">{servers.length ? <><label className="settings-form">Server<select value={serverId} onChange={(event) => setServerId(event.target.value)}>{servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}</select></label>{loading ? <p className="settings-note">Loading members…</p> : members.map((member) => <div className="session-row" key={member.user.id}><Avatar user={member.user} size={36} /><span><strong>{member.user.displayName}</strong><small>{member.role}</small></span>{member.role !== "owner" && member.user.id !== app.me?.id && <button className="text-button danger-text" onClick={() => setRemoveTarget(member)}>Remove</button>}</div>)}</> : <p className="settings-note">Create or own a server to manage its members here.</p>}</SettingsGroup><SettingsGroup title="Storage and retention"><p className="settings-note">Server storage limits and retention policies apply to every client.</p></SettingsGroup>{removeTarget && <ConfirmDialog title="Remove member" body={`Remove ${removeTarget.user.displayName} from this server?`} confirmLabel="Remove" destructive onCancel={() => setRemoveTarget(null)} onConfirm={() => void remove(removeTarget)} />}</SettingsPage>;
}

function minutesToTime(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
function timeToMinutes(value: string) { const [hours = 0, minutes = 0] = value.split(":").map(Number); return hours * 60 + minutes; }
