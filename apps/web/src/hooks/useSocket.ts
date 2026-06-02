import { useEffect, useState } from "react";
import { getSocket, connectSocket, disconnectSocket } from "../lib/socket.js";
import { useAuthStore } from "../stores/authStore.js";
import { useMessageStore } from "../stores/messageStore.js";
import { usePresenceStore } from "../stores/presenceStore.js";
import { useVoiceStore } from "../stores/voiceStore.js";
import { useUIStore } from "../stores/uiStore.js";
import { playNotificationSound } from "../lib/sounds.js";

export function useSocket() {
  const { isAuthenticated, user, logout } = useAuthStore();
  const addMessage = useMessageStore((state) => state.addMessage);
  const updateMessageReactions = useMessageStore((state) => state.updateMessageReactions);
  const removeMessage = useMessageStore((state) => state.removeMessage);
  const editMessage = useMessageStore((state) => state.editMessage);
  const updateUserPresence = usePresenceStore((state) => state.updateUserPresence);
  const setOnlineUsers = usePresenceStore((state) => state.setOnlineUsers);
  const setTypingUsers = usePresenceStore((state) => state.setTypingUsers);
  const fetchUsers = usePresenceStore((state) => state.fetchUsers);
  const setParticipants = useVoiceStore((state) => state.setParticipants);
  const addParticipant = useVoiceStore((state) => state.addParticipant);
  const removeParticipant = useVoiceStore((state) => state.removeParticipant);
  const updateVoiceDiagnostics = useVoiceStore((state) => state.updateDiagnostics);

  const loadHistory = useMessageStore((state) => state.loadHistory);
  const clearMessages = useMessageStore((state) => state.clearMessages);
  const fetchConversations = useMessageStore((state) => state.fetchConversations);

  const [connected, setConnected] = useState(false);
  const userId = user?.id;

  useEffect(() => {
    if (!isAuthenticated || !userId) {
      disconnectSocket();
      setConnected(false);
      return;
    }

    const socket = getSocket();
    connectSocket();
    fetchConversations(); // Load DMs on startup

    const onConnect = () => {
      setConnected(true);
      updateVoiceDiagnostics({ socketConnected: true, socketId: socket.id || null });
    };

    const onDisconnect = () => {
      setConnected(false);
      updateVoiceDiagnostics({ socketConnected: false, socketId: socket.id || null });
    };

    const onRoomState = (state: { voiceParticipants: any[]; onlineUserIds?: string[] }) => {
      if (useMessageStore.getState().activeConversationId === "global") {
        setParticipants(state.voiceParticipants);
      }
      if (state.onlineUserIds) {
        setOnlineUsers(state.onlineUserIds);
      }
    };

    const onPresenceUpdate = (data: { userId: string; status: "online" | "offline"; lastSeenAt: number }) => {
      updateUserPresence(data.userId, data.status === "online", data.lastSeenAt);
    };

    const onTypingUpdate = (data: { conversationId?: string; typers: string[] }) => {
      if (data.conversationId && data.conversationId !== useMessageStore.getState().activeConversationId) {
        return;
      }
      setTypingUsers(data.typers.filter((id) => id !== userId));
    };

    const onMessageNew = (msg: any) => {
      addMessage(msg);

      // Play sound and trigger notification for other users' messages
      if (msg.userId !== userId) {
        const { notificationsMuted, notificationSound, desktopNotificationsEnabled } = useUIStore.getState();

        // 1. Play sound if not muted
        if (!notificationsMuted && notificationSound !== "none") {
          playNotificationSound(notificationSound);
        }

        // 2. Trigger browser desktop notification if tab is in the background or out of focus
        if (desktopNotificationsEnabled && (document.hidden || !document.hasFocus())) {
          try {
            const notification = new Notification(`🌸 ${msg.user?.displayName || "Someone"}`, {
              body: msg.type === "file" ? "📁 Sent an attachment" : msg.content,
              tag: msg.conversationId || "global",
            });

            notification.onclick = () => {
              window.focus();
              if (msg.conversationId) {
                useMessageStore.getState().setActiveConversationId(msg.conversationId);
              }
            };
          } catch (err) {
            console.error("Failed to display desktop notification", err);
          }
        }
      }
    };

    const onMessageReactionsUpdate = (data: { messageId: string; reactions: any[] }) => {
      updateMessageReactions(data.messageId, data.reactions);
    };

    const onMessageDeleted = (data: { messageId: string }) => {
      removeMessage(data.messageId);
    };

    const onMessageEdited = (data: { message: any }) => {
      editMessage(data.message);
    };

    const onMessageClearedAll = () => {
      clearMessages();
    };

    const onError = (data: { message: string }) => {
      console.error("Socket error from server:", data.message);
      alert("Server error: " + data.message);
    };

    const onKicked = async () => {
      await logout();
      alert("You were removed from this server.");
    };

    const isCurrentConversation = (conversationId?: string) => {
      return (conversationId || "global") === useMessageStore.getState().activeConversationId;
    };

    const onVoiceUpdateParticipants = (data: { conversationId?: string; participants?: any[] } | any[]) => {
      if (Array.isArray(data)) {
        setParticipants(data);
        return;
      }

      if (isCurrentConversation(data.conversationId)) {
        setParticipants(data.participants || []);
      }
    };

    const onVoiceUserJoined = (participant: any) => {
      if (isCurrentConversation(participant.conversationId)) {
        addParticipant(participant);
      }
    };

    const onVoiceUserLeft = (data: { conversationId?: string; socketId: string; userId: string }) => {
      if (isCurrentConversation(data.conversationId)) {
        removeParticipant(data.socketId);
      }
    };

    const onReconnect = () => {
      setConnected(true);
      loadHistory(); // Refetch missed messages
      fetchConversations(); // Refetch conversations list
      fetchUsers(); // Refresh user list
      setTypingUsers([]); // Clear stale typing indicators
      
      // Attempt to rejoin voice call if we were in one
      const voiceState = useVoiceStore.getState();
      if (voiceState.isInCall) {
        socket.emit("voice:join", {
          conversationId: voiceState.callConversationId || useMessageStore.getState().activeConversationId,
        });
      }
    };

    socket.on("connect", onConnect);
    socket.io.on("reconnect", onReconnect); // socket.io-client uses io for reconnection events
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onRoomState);
    socket.on("presence:update", onPresenceUpdate);
    socket.on("typing:update", onTypingUpdate);
    socket.on("message:new", onMessageNew);
    socket.on("message:reactions_update", onMessageReactionsUpdate);
    socket.on("message:deleted", onMessageDeleted);
    socket.on("message:edited", onMessageEdited);
    socket.on("message:cleared_all", onMessageClearedAll);
    socket.on("error", onError);
    socket.on("auth:kicked", onKicked);
    socket.on("voice:update-participants", onVoiceUpdateParticipants);
    socket.on("voice:user-joined", onVoiceUserJoined);
    socket.on("voice:user-left", onVoiceUserLeft);

    // Initial state check in case socket was already connected
    if (socket.connected) {
      setConnected(true);
    }

    return () => {
      socket.off("connect", onConnect);
      socket.io.off("reconnect", onReconnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onRoomState);
      socket.off("presence:update", onPresenceUpdate);
      socket.off("typing:update", onTypingUpdate);
      socket.off("message:new", onMessageNew);
      socket.off("message:reactions_update", onMessageReactionsUpdate);
      socket.off("message:deleted", onMessageDeleted);
      socket.off("message:edited", onMessageEdited);
      socket.off("message:cleared_all", onMessageClearedAll);
      socket.off("error", onError);
      socket.off("auth:kicked", onKicked);
      socket.off("voice:update-participants", onVoiceUpdateParticipants);
      socket.off("voice:user-joined", onVoiceUserJoined);
      socket.off("voice:user-left", onVoiceUserLeft);
    };
  }, [isAuthenticated, userId, logout, updateVoiceDiagnostics]);

  return connected;
}
