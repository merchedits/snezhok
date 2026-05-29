import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "../stores/authStore.js";
import { useMessageStore } from "../stores/messageStore.js";
import { usePresenceStore } from "../stores/presenceStore.js";
import { useUIStore } from "../stores/uiStore.js";
import Sidebar from "../components/chat/Sidebar.jsx";
import ChatHeader from "../components/chat/ChatHeader.jsx";
import VoiceBanner from "../components/chat/VoiceBanner.jsx";
import MessageBubble from "../components/chat/MessageBubble.jsx";
import MessageInput from "../components/chat/MessageInput.jsx";
import MemberPanel from "../components/chat/MemberPanel.jsx";
import TypingIndicator from "../components/TypingIndicator.jsx";
import Modal from "../components/Modal.jsx";
import Input from "../components/Input.jsx";
import Button from "../components/Button.jsx";
import { getSocket } from "../lib/socket.js";
import { Loader2, Plus, Copy, Check } from "lucide-react";

const AVATAR_COLORS = [
  "#FFCFB3", "#E8A882", "#F2B8C6", "#C5B8E8", "#B5CDB5",
  "#F5E6A3", "#A8D8EA", "#FFB3B3", "#B8E8C5", "#E8D5B5",
  "#D4A5A5", "#9FCCB5", "#C9A5E8", "#E8C5A5", "#A5C5E8",
];

interface InviteCode {
  id: string;
  code: string;
  createdBy: string;
  usedBy: string | null;
  usedAt: number | null;
  createdAt: number;
}

export default function ChatPage() {
  const { user } = useAuthStore();
  const { messages, isLoading, hasMore, loadHistory } = useMessageStore();
  const { fetchUsers, usersList } = usePresenceStore();
  const memberPanelOpen = useUIStore((state) => state.memberPanelOpen);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<"profile" | "admin">("profile");

  // Profile Edit States
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const updateDisplayName = useAuthStore((state) => state.updateDisplayName);
  const updateAvatarColor = useAuthStore((state) => state.updateAvatarColor);

  // Invite Admin States
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [isGeneratingInvite, setIsGeneratingInvite] = useState(false);
  const [customInviteCode, setCustomInviteCode] = useState("");
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [showUnreadBadge, setShowUnreadBadge] = useState(false);

  // Load initial data
  useEffect(() => {
    loadHistory();
    fetchUsers();

    // Poll users presence list occasionally
    const interval = setInterval(() => {
      fetchUsers();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // Handle screenshare video elements
  useEffect(() => {
    const handleNewScreenshare = (e: any) => {
      const container = document.getElementById("screenshare-container");
      if (container && e.detail?.videoElement) {
        container.appendChild(e.detail.videoElement);
        container.style.display = "flex";
      }
    };

    const handleEndedScreenshare = () => {
      const container = document.getElementById("screenshare-container");
      if (container && container.childNodes.length === 0) {
        container.style.display = "none";
      }
    };

    window.addEventListener("screenshare:new", handleNewScreenshare);
    window.addEventListener("screenshare:ended", handleEndedScreenshare);

    return () => {
      window.removeEventListener("screenshare:new", handleNewScreenshare);
      window.removeEventListener("screenshare:ended", handleEndedScreenshare);
    };
  }, []);

  // Update profile inputs when user loads
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
    }
  }, [user]);

  // Scroll to bottom on new message
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container || messages.length === 0) return;

    const lastMsg = messages[messages.length - 1];
    const isOwn = lastMsg.userId === user?.id;

    // Check if scrolled near bottom (within 200px)
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 200;

    if (isNearBottom || isOwn) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      setShowUnreadBadge(false);
    } else {
      setShowUnreadBadge(true);
    }
  }, [messages, user]);

  // Handle pagination and scrolling up
  const handleScroll = async () => {
    const container = chatContainerRef.current;
    if (!container) return;

    // Check if near bottom to clear badge
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 200;
    if (isNearBottom && showUnreadBadge) {
      setShowUnreadBadge(false);
    }

    if (isLoading || !hasMore) return;

    // If scrolled to top, fetch more history
    if (container.scrollTop === 0 && messages.length > 0) {
      const oldestMsg = messages[0];
      const previousScrollHeight = container.scrollHeight;

      await loadHistory(oldestMsg.createdAt);

      // Restore scroll position
      container.scrollTop = container.scrollHeight - previousScrollHeight;
    }
  };

  // Profile Save
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;

    setIsSavingProfile(true);
    setProfileSuccess(false);
    
    const success = await updateDisplayName(displayName.trim());
    setIsSavingProfile(false);
    
    if (success) {
      setProfileSuccess(true);
      fetchUsers(); // Refresh list to update display names
      
      // Emit details update via socket
      const socket = getSocket();
      socket.emit("typing:stop"); // forces a dummy state ping or we rely on interval fetch
      
      setTimeout(() => setProfileSuccess(false), 2000);
    }
  };

  // Admin Load Invite Codes
  const fetchInvites = async () => {
    try {
      const res = await fetch("/api/users/invites");
      if (res.ok) {
        const data = await res.json();
        setInviteCodes(data.invites || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (settingsOpen && activeSettingsTab === "admin" && user?.isAdmin) {
      fetchInvites();
    }
  }, [settingsOpen, activeSettingsTab, user]);

  // Admin Generate Invite Code
  const handleGenerateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsGeneratingInvite(true);
    setInviteError(null);

    try {
      const res = await fetch("/api/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: customInviteCode.trim() || undefined }),
      });

      const data = await res.json();
      if (res.ok) {
        setCustomInviteCode("");
        fetchInvites();
      } else {
        setInviteError(data.error || "Failed to create invite");
      }
    } catch (err) {
      setInviteError("Network error occurred");
    } finally {
      setIsGeneratingInvite(false);
    }
  };

  // Copy helper
  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  // Group messages from same user within 5 minutes
  const renderMessages = () => {
    const rendered: React.ReactNode[] = [];
    let currentGroupUser = "";
    let currentGroupTime = 0;

    messages.forEach((msg) => {
      const isNewGroup =
        msg.userId !== currentGroupUser ||
        msg.createdAt - currentGroupTime > 5 * 60 * 1000 || // 5 minutes threshold
        msg.type === "system";

      if (isNewGroup) {
        currentGroupUser = msg.userId;
        currentGroupTime = msg.createdAt;
      }

      rendered.push(
        <MessageBubble
          key={msg.id}
          message={msg}
          isGroupStart={isNewGroup}
        />
      );
    });

    return rendered;
  };

  return (
    <div className="app-container">
      {/* Sidebar (rail icons) */}
      <Sidebar onOpenSettings={() => setSettingsOpen(true)} />

      {/* Main Chat Area */}
      <main className="chat-area" aria-label="Main chat area">
        {/* Voice Call Banner if any users connected */}
        <VoiceBanner />
        
        {/* Screenshare Container */}
        <div 
          id="screenshare-container" 
          style={{ 
            display: "none", 
            flexDirection: "column", 
            gap: "16px", 
            padding: "16px",
            background: "var(--color-bg-base)",
            borderBottom: "1px solid rgba(168, 151, 140, 0.15)"
          }} 
        />

        {/* Chat Area Header */}
        <ChatHeader />

        {/* Messages List Container */}
        <div
          ref={chatContainerRef}
          className="messages-container"
          onScroll={handleScroll}
          role="log"
          aria-live="polite"
        >
          {isLoading && messages.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "16px" }}>
              {/* Skeleton UI loaders */}
              <div style={{ width: "200px", height: "40px", borderRadius: "8px", background: "var(--color-bg-subtle)", animation: "skeletonPulse 1.2s infinite" }} />
              <div style={{ width: "300px", height: "50px", borderRadius: "8px", background: "var(--color-bg-subtle)", animation: "skeletonPulse 1.2s infinite" }} />
              <div style={{ width: "150px", height: "40px", borderRadius: "8px", background: "var(--color-bg-subtle)", animation: "skeletonPulse 1.2s infinite" }} />
            </div>
          ) : messages.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-text-secondary)",
                padding: "var(--space-10)",
                textAlign: "center",
                gap: "12px",
              }}
            >
              <span style={{ fontSize: "48px" }}>👋</span>
              <h3 style={{ fontFamily: "var(--font-display)", fontWeight: 700 }}>Say hello!</h3>
              <p style={{ fontSize: "var(--text-sm)", maxWidth: "320px" }}>
                You're the first one here. Send a message to get the conversation going.
              </p>
            </div>
          ) : (
            renderMessages()
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Unread Badge */}
        {showUnreadBadge && (
          <div
            style={{
              position: "absolute",
              bottom: "80px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 10,
            }}
          >
            <Button
              variant="primary"
              onClick={() => {
                messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
                setShowUnreadBadge(false);
              }}
              style={{ borderRadius: "16px", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}
            >
              New messages ↓
            </Button>
          </div>
        )}

        {/* Active Typers list */}
        <TypingIndicator />

        {/* Chat Message Box Input */}
        <MessageInput />
      </main>

      {/* Members sidebar rail list */}
      {memberPanelOpen && <MemberPanel />}

      {/* Settings Modal Dashboard */}
      <Modal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} title="Settings 🌸">
        <div style={{ display: "flex", gap: "16px", borderBottom: "1px solid var(--color-bg-subtle)", paddingBottom: "12px", marginBottom: "16px" }}>
          <button
            onClick={() => setActiveSettingsTab("profile")}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: "var(--text-base)",
              fontWeight: 600,
              fontFamily: "var(--font-display)",
              color: activeSettingsTab === "profile" ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
              borderBottom: activeSettingsTab === "profile" ? "2px solid var(--color-peach)" : "none",
              paddingBottom: "4px",
            }}
          >
            My Profile
          </button>
          {user?.isAdmin && (
            <button
              onClick={() => setActiveSettingsTab("admin")}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: "var(--text-base)",
                fontWeight: 600,
                fontFamily: "var(--font-display)",
                color: activeSettingsTab === "admin" ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                borderBottom: activeSettingsTab === "admin" ? "2px solid var(--color-peach)" : "none",
                paddingBottom: "4px",
              }}
            >
              Admin Invites
            </button>
          )}
        </div>

        {activeSettingsTab === "profile" ? (
          <form onSubmit={handleSaveProfile} className="auth-form">
            <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "8px" }}>
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  backgroundColor: user?.avatarColor,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: "18px",
                }}
              >
                {user?.displayName.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h4 style={{ fontWeight: 600 }}>{user?.username}</h4>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                  Registered user
                </p>
              </div>
            </div>

            {/* Avatar Color Picker */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <label className="form-label">Avatar Color</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {AVATAR_COLORS.map((color) => (
                  <div
                    key={color}
                    onClick={async () => {
                      await updateAvatarColor(color);
                      fetchUsers();
                    }}
                    style={{
                      width: "36px",
                      height: "36px",
                      borderRadius: "50%",
                      backgroundColor: color,
                      cursor: "pointer",
                      border: user?.avatarColor === color ? "3px solid var(--color-text-primary)" : "3px solid transparent",
                      transition: "border-color 0.15s ease, transform 0.15s ease",
                      transform: user?.avatarColor === color ? "scale(1.15)" : "scale(1)",
                    }}
                    title={color}
                  />
                ))}
              </div>
            </div>

            <Input
              label="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your public nickname..."
              disabled={isSavingProfile}
              required
            />

            {profileSuccess && (
              <p style={{ color: "var(--color-sage)", fontSize: "var(--text-sm)", fontWeight: 500 }}>
                ✓ Profile updated successfully!
              </p>
            )}

            <Button type="submit" disabled={isSavingProfile}>
              {isSavingProfile ? "Saving..." : "Save Changes"}
            </Button>
          </form>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <form onSubmit={handleGenerateInvite} style={{ display: "flex", gap: "12px", alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <Input
                  label="Create Invite Code"
                  placeholder="Custom code (leave blank for random)..."
                  value={customInviteCode}
                  onChange={(e) => setCustomInviteCode(e.target.value)}
                  disabled={isGeneratingInvite}
                />
              </div>
              <Button type="submit" disabled={isGeneratingInvite} style={{ height: "38px" }}>
                {isGeneratingInvite ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
                Generate
              </Button>
            </form>

            {inviteError && (
              <p style={{ color: "var(--color-destructive)", fontSize: "var(--text-sm)" }}>{inviteError}</p>
            )}

            <div style={{ marginTop: "8px" }}>
              <h4 style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginBottom: "8px" }}>
                Active Invite Codes
              </h4>
              <div
                style={{
                  maxHeight: "180px",
                  overflowY: "auto",
                  border: "1px solid var(--color-bg-subtle)",
                  borderRadius: "8px",
                  background: "var(--color-bg-surface)",
                }}
              >
                {inviteCodes.length === 0 ? (
                  <p style={{ padding: "12px", textAlign: "center", fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>
                    No invite codes generated yet.
                  </p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "var(--text-xs)" }}>
                    <thead>
                      <tr style={{ background: "var(--color-bg-subtle)", textAlign: "left" }}>
                        <th style={{ padding: "8px" }}>Code</th>
                        <th style={{ padding: "8px" }}>Status</th>
                        <th style={{ padding: "8px" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inviteCodes.map((ic) => (
                        <tr key={ic.id} style={{ borderBottom: "1px solid var(--color-bg-subtle)" }}>
                          <td style={{ padding: "8px", fontWeight: "bold" }}>{ic.code}</td>
                          <td style={{ padding: "8px" }}>
                            {ic.usedBy ? (
                              <span style={{ color: "var(--color-text-tertiary)" }}>
                                Used by {usersList.find((u) => u.id === ic.usedBy)?.displayName || "User"}
                              </span>
                            ) : (
                              <span style={{ color: "var(--color-sage)", fontWeight: 500 }}>Unused</span>
                            )}
                          </td>
                          <td style={{ padding: "8px" }}>
                            {!ic.usedBy && (
                              <Button
                                variant="ghost"
                                onClick={() => copyToClipboard(ic.code, ic.id)}
                                style={{ height: "24px", padding: "0 6px", minWidth: "50px" }}
                              >
                                {copiedCodeId === ic.id ? <Check size={12} /> : <Copy size={12} />}
                                {copiedCodeId === ic.id ? "Copied" : "Copy"}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
