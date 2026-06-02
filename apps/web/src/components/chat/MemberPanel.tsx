import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Activity, Check, MessageCircle, UserX, UsersRound, X } from "lucide-react";
import Avatar from "../Avatar.jsx";
import Button from "../Button.jsx";
import Modal from "../Modal.jsx";
import { useAuthStore } from "../../stores/authStore.js";
import { usePresenceStore, PresenceUser } from "../../stores/presenceStore.js";
import { useVoiceStore } from "../../stores/voiceStore.js";
import { useMessageStore } from "../../stores/messageStore.js";
import { useUIStore } from "../../stores/uiStore.js";
import { useTranslation } from "../../i18n/index.jsx";

type MemberSection = {
  id: string;
  label: string;
  members: PresenceUser[];
  inCall?: boolean;
  muted?: boolean;
};

export default function MemberPanel() {
  const currentUser = useAuthStore((state) => state.user);
  const usersList = usePresenceStore((state) => state.usersList);
  const fetchUsers = usePresenceStore((state) => state.fetchUsers);
  const voiceParticipants = useVoiceStore((state) => state.participants);
  const toggleMemberPanel = useUIStore((state) => state.toggleMemberPanel);
  const startDM = useMessageStore((state) => state.startDM);
  const startGroup = useMessageStore((state) => state.startGroup);
  const { t } = useTranslation();

  const [contextUser, setContextUser] = useState<PresenceUser | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isUserInVoice = (userId: string) => voiceParticipants.some((p) => p.userId === userId);
  const isUserSpeaking = (userId: string) => voiceParticipants.find((p) => p.userId === userId)?.isSpeaking || false;

  const sections: MemberSection[] = useMemo(() => {
    const inCallUsers = usersList.filter((u) => isUserInVoice(u.id));
    const onlineUsersNotInCall = usersList.filter((u) => u.isOnline && !isUserInVoice(u.id));
    const offlineUsers = usersList.filter((u) => !u.isOnline);

    return [
      { id: "call", label: t('members.inCallNow'), members: inCallUsers, inCall: true },
      { id: "online", label: `${t('members.onlineSection')} - ${onlineUsersNotInCall.length}`, members: onlineUsersNotInCall },
      { id: "offline", label: `${t('members.offlineSection')} - ${offlineUsers.length}`, members: offlineUsers, muted: true },
    ].filter((section) => section.members.length > 0);
  }, [usersList, voiceParticipants, t]);

  useEffect(() => {
    if (!contextUser) return;

    const close = (event: globalThis.MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(event.target as Node)) return;
      setContextUser(null);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextUser(null);
    };

    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextUser]);

  const openMemberMenu = (event: MouseEvent, member: PresenceUser) => {
    if (member.id === currentUser?.id) return;

    event.preventDefault();
    const x = Math.min(event.clientX, window.innerWidth - 220);
    const y = Math.min(event.clientY, window.innerHeight - 120);
    setMenuPosition({ x: Math.max(8, x), y: Math.max(8, y) });
    setContextUser(member);
  };

  const handleTapMember = (event: MouseEvent, member: PresenceUser) => {
    if (window.matchMedia("(max-width: 768px)").matches) {
      openMemberMenu(event, member);
    }
  };

  const handleStartDM = async () => {
    if (!contextUser) return;
    await startDM(contextUser.id);
    setContextUser(null);
  };

  const openGroupModal = () => {
    if (!contextUser) return;
    setSelectedGroupIds([contextUser.id]);
    setGroupError(null);
    setGroupModalOpen(true);
    setContextUser(null);
  };

  const toggleGroupUser = (userId: string) => {
    setSelectedGroupIds((ids) =>
      ids[0] === userId ? ids :
      ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId]
    );
  };

  const handleCreateGroup = async () => {
    setGroupError(null);
    if (selectedGroupIds.length < 2) {
      setGroupError("Pick at least two people for a group chat.");
      return;
    }

    try {
      setIsCreatingGroup(true);
      await startGroup(selectedGroupIds);
      setGroupModalOpen(false);
      setSelectedGroupIds([]);
    } catch (err: any) {
      setGroupError(err?.message || "Could not create group chat.");
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleKickMember = async () => {
    if (!contextUser || !currentUser?.isAdmin) return;

    const confirmed = confirm(`Kick ${contextUser.displayName}? Their account will be removed from this server.`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/users/${encodeURIComponent(contextUser.id)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Could not kick member.");
      }
      await fetchUsers();
      setContextUser(null);
    } catch (err: any) {
      alert(err?.message || "Could not kick member.");
    }
  };

  const availableGroupUsers = usersList.filter((member) => member.id !== currentUser?.id);
  const pinnedGroupUserId = selectedGroupIds[0];

  return (
    <aside className="member-panel" aria-label="Member List">
      <div className="member-panel-header">
        <span>{t('members.title')}</span>
        <Button variant="ghost" onClick={toggleMemberPanel} style={{ padding: 0, width: "28px", height: "28px" }}>
          <X size={18} />
        </Button>
      </div>

      <div className="member-panel-body">
        {sections.map((section) => (
          <div className="member-section" key={section.id}>
            <div className="member-section-label">{section.label}</div>
            {section.members.map((member) => (
              <button
                key={member.id}
                className={`member-item ${section.inCall ? "in-call" : ""} ${section.muted ? "muted" : ""}`}
                onContextMenu={(event) => openMemberMenu(event, member)}
                onClick={(event) => handleTapMember(event, member)}
                title={member.id === currentUser?.id ? member.displayName : "Right click for actions"}
              >
                <Avatar
                  displayName={member.displayName}
                  username={member.username}
                  avatarColor={member.avatarColor}
                  avatarUrl={member.avatarUrl}
                  size="sm"
                  showOnline={!section.muted}
                  isOnline={member.isOnline}
                  isSpeaking={isUserSpeaking(member.id)}
                />
                <span className="member-name">{member.displayName}</span>
                {section.inCall && <Activity size={14} color="var(--color-online)" />}
              </button>
            ))}
          </div>
        ))}
      </div>

      {contextUser && (
        <div
          ref={menuRef}
          className="member-context-menu"
          style={{ left: `${menuPosition.x}px`, top: `${menuPosition.y}px` }}
        >
          <div className="member-context-title">{contextUser.displayName}</div>
          <button className="member-context-action" onClick={handleStartDM}>
            <MessageCircle size={15} />
            Message
          </button>
          <button className="member-context-action" onClick={openGroupModal}>
            <UsersRound size={15} />
            Invite to group chat
          </button>
          {currentUser?.isAdmin && (
            <button className="member-context-action danger" onClick={handleKickMember}>
              <UserX size={15} />
              Kick member
            </button>
          )}
        </div>
      )}

      <Modal isOpen={groupModalOpen} onClose={() => setGroupModalOpen(false)} title="Create group chat" size="md">
        <div className="group-invite-list">
          {availableGroupUsers.map((member) => {
            const checked = selectedGroupIds.includes(member.id);
            const pinned = member.id === pinnedGroupUserId;
            return (
              <button
                key={member.id}
                className={`group-invite-row ${checked ? "selected" : ""}`}
                onClick={(event) => {
                  event.preventDefault();
                  if (!pinned) toggleGroupUser(member.id);
                }}
              >
                <Avatar
                  displayName={member.displayName}
                  username={member.username}
                  avatarColor={member.avatarColor}
                  avatarUrl={member.avatarUrl}
                  size="sm"
                  showOnline={true}
                  isOnline={member.isOnline}
                />
                <span>{member.displayName}</span>
                <span className="group-invite-check">{checked && <Check size={15} />}</span>
              </button>
            );
          })}
        </div>

        {groupError && <p className="form-error">{groupError}</p>}

        <div className="group-invite-actions">
          <Button variant="ghost" onClick={() => setGroupModalOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateGroup} disabled={isCreatingGroup || selectedGroupIds.length < 2}>
            {isCreatingGroup ? "Creating..." : "Create group"}
          </Button>
        </div>
      </Modal>
    </aside>
  );
}
