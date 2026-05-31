import { useEffect, useState } from "react";
import { getSocket, connectSocket, disconnectSocket } from "../lib/socket.js";
import { useAuthStore } from "../stores/authStore.js";
import { useMessageStore } from "../stores/messageStore.js";
import { usePresenceStore } from "../stores/presenceStore.js";
import { useVoiceStore } from "../stores/voiceStore.js";

export function useSocket() {
  const { isAuthenticated, user } = useAuthStore();
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
    };

    const onDisconnect = () => {
      setConnected(false);
    };

    const onRoomState = (state: { voiceParticipants: any[]; onlineUserIds?: string[] }) => {
      setParticipants(state.voiceParticipants);
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

    const onVoiceUpdateParticipants = (list: any[]) => {
      setParticipants(list);
    };

    const onVoiceUserJoined = (participant: any) => {
      addParticipant(participant);
    };

    const onVoiceUserLeft = (data: { socketId: string; userId: string }) => {
      removeParticipant(data.socketId);
    };

    const onReconnect = () => {
      setConnected(true);
      loadHistory(); // Refetch missed messages
      fetchConversations(); // Refetch conversations list
      fetchUsers(); // Refresh user list
      setTypingUsers([]); // Clear stale typing indicators
      
      // Attempt to rejoin voice call if we were in one
      if (useVoiceStore.getState().isInCall) {
        socket.emit("voice:join");
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
      socket.off("voice:update-participants", onVoiceUpdateParticipants);
      socket.off("voice:user-joined", onVoiceUserJoined);
      socket.off("voice:user-left", onVoiceUserLeft);
    };
  }, [isAuthenticated, userId]);

  return connected;
}
