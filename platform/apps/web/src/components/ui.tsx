import { useEffect, useRef, type ButtonHTMLAttributes, type PropsWithChildren } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Presence, UserSummary } from "@snezhok/contracts";

export function Avatar({ user, name, url, color, size = 40, presence }: {
  user?: UserSummary | undefined;
  name?: string | undefined;
  url?: string | null | undefined;
  color?: string | undefined;
  size?: number;
  presence?: Presence | undefined;
}) {
  const label = user?.displayName || name || "Unknown";
  const image = user?.avatarUrl || url;
  const background = user?.avatarColor || color || "#5865f2";
  return (
    <span className="avatar" style={{ width: size, height: size, background }} aria-label={label}>
      {image ? <img src={image} alt="" /> : label.trim().slice(0, 2).toUpperCase()}
      {presence && presence !== "offline" && <i className={`presence presence-${presence}`} aria-label={presence} />}
    </span>
  );
}

export function IconButton({ label, active, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "is-active" : ""} ${className}`}
      aria-label={label}
      title={label}
      aria-pressed={active}
      {...props}
    />
  );
}

export function Dialog({ title, onClose, children, className = "" }: PropsWithChildren<{ title: string; onClose: () => void; className?: string }>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("keydown", close); previous?.focus(); };
  }, [onClose]);

  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={ref} className={`dialog ${className}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <header className="dialog-header">
          <h2>{title}</h2>
          <IconButton label="Close" onClick={onClose}><X /></IconButton>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ title, body, confirmLabel, destructive = false, onCancel, onConfirm }: { title: string; body: string; confirmLabel: string; destructive?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <Dialog title={title} onClose={onCancel} className="confirm-dialog"><p>{body}</p><div className="dialog-actions"><button className="button button-secondary" onClick={onCancel}>Cancel</button><button className={`button ${destructive ? "button-danger" : "button-primary"}`} onClick={onConfirm}>{confirmLabel}</button></div></Dialog>;
}

export function EmptyState({ icon, text, action }: { icon: React.ReactNode; text: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span aria-hidden="true">{icon}</span><p>{text}</p>{action}</div>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="spinner" role="status"><i /> <span className="sr-only">{label}</span></span>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? "is-on" : ""}`} onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

export function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

export function formatDay(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" }).format(date);
}
