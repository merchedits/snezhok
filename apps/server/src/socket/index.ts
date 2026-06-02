import { Server, Socket } from "socket.io";
import { validateSession } from "../services/auth.js";
import { setOnline, setOffline, setTyping, getSocketsByUser, getOnlineUsers } from "../services/presence.js";
import { createMessage, addReaction, removeReaction, getMessageById, deleteMessage, editMessage, clearAllMessages } from "../services/messages.js";
import { getUserConversations, checkUserAccessToConversation } from "../services/conversations.js";
import { resolveSessionCookie } from "../lib/session.js";
import { getFileMetadata } from "../services/files.js";

// In-memory set of voice call participants: socketId -> user details
interface VoiceParticipant {
  socketId: string;
  conversationId: string;
  userId: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarUrl?: string | null;
}
const voiceParticipantsByConversation = new Map<string, Map<string, VoiceParticipant>>();
let activeSocketServer: Server | null = null;
const MAX_VOICE_FRAME_BYTES = 24 * 1024;
const MAX_VOICE_BYTES_PER_WINDOW = 384 * 1024;
const VOICE_RATE_WINDOW_MS = 1000;

function getVoiceRoomParticipants(conversationId: string) {
  return Array.from(voiceParticipantsByConversation.get(conversationId)?.values() || []);
}

function findVoiceConversationBySocket(socketId: string) {
  for (const [conversationId, participants] of voiceParticipantsByConversation.entries()) {
    if (participants.has(socketId)) return conversationId;
  }
  return null;
}

export function disconnectUserSockets(userId: string) {
  if (!activeSocketServer) return;
  const socketIds = getSocketsByUser(userId);
  socketIds.forEach((id) => {
    const socket = activeSocketServer?.sockets.sockets.get(id);
    if (socket) {
      socket.emit("auth:kicked");
      socket.disconnect(true);
    }
  });
}

export function setupSocketIO(io: Server) {
  activeSocketServer = io;

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      if (!cookieHeader) {
        return next(new Error("Authentication error: No cookies found"));
      }

      // Simple cookie parser
      const parsedCookies = Object.fromEntries(
        cookieHeader.split(";").map((c) => {
          const parts = c.trim().split("=");
          const rawValue = parts.slice(1).join("=");
          let value = rawValue;
          try {
            value = decodeURIComponent(rawValue);
          } catch {
            // Keep the raw value if a client sends a non-encoded cookie.
          }
          return [parts[0], value];
        })
      );

      const sessionId = resolveSessionCookie(parsedCookies["sessionId"]);
      if (!sessionId) {
        return next(new Error("Authentication error: No sessionId cookie"));
      }

      const user = await validateSession(sessionId);
      if (!user) {
        return next(new Error("Authentication error: Invalid session"));
      }

      socket.data.user = user;
      next();
    } catch (err) {
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const user = socket.data.user;
    const socketId = socket.id;

    // 1. Handle presence online
    setOnline(user.id, socketId);
    
    // Broadcast presence update
    io.emit("presence:update", {
      userId: user.id,
      status: "online",
      lastSeenAt: Date.now(),
    });

    // Send the current list of online users and active voice participants to the new socket
    socket.emit("room:state", {
      voiceParticipants: getVoiceRoomParticipants("global"),
      onlineUserIds: getOnlineUsers(),
    });

    // 1b. Join socket rooms for conversations
    socket.join("room:global");
    getUserConversations(user.id)
      .then((convs) => {
        convs.forEach((c) => {
          socket.join(`room:${c.id}`);
        });
      })
      .catch((err) => {
        console.error("Failed to join conversation rooms for user:", user.id, err);
      });

    // Listen for joining new rooms dynamically (when DMs are started in real time)
    socket.on("room:join", async (data: { conversationId: string }) => {
      try {
        if (!data?.conversationId) return;
        const hasAccess = await checkUserAccessToConversation(user.id, data.conversationId);
        if (!hasAccess) {
          throw new Error("You do not have permission to join this conversation.");
        }
        socket.join(`room:${data.conversationId}`);
        socket.emit("voice:update-participants", {
          conversationId: data.conversationId,
          participants: getVoiceRoomParticipants(data.conversationId),
        });
      } catch (err: any) {
        socket.emit("error", { message: err.message });
      }
    });

    // Rate limiting maps for this socket
    const rateLimits = {
      message: 0,
      reaction: 0,
      typing: 0,
      voiceAudioBytes: 0,
      voiceAudioWindowStartedAt: Date.now(),
      voiceFramesReceived: 0,
      voiceBytesReceived: 0,
      voiceDroppedFrames: 0,
      voiceLastStatsAt: 0,
    };

    // 2. Chat messaging events
    socket.on("message:send", async (data: { content: string; type?: string; fileId?: string; replyToId?: string; conversationId?: string }) => {
      try {
        const now = Date.now();
        if (now - rateLimits.message < 1000) {
          throw new Error("You are sending messages too fast.");
        }
        rateLimits.message = now;

        if (!data || !data.content || typeof data.content !== "string") {
          throw new Error("Invalid message format.");
        }
        
        if (data.content.length > 4000) {
          throw new Error("Message exceeds 4000 characters limit.");
        }

        const conversationId = data.conversationId || "global";
        const hasAccess = await checkUserAccessToConversation(user.id, conversationId);
        if (!hasAccess) {
          throw new Error("You do not have permission to post in this conversation.");
        }

        const messageType = data.type || "text";
        if (!["text", "file"].includes(messageType)) {
          throw new Error("Invalid message type.");
        }

        if (messageType === "file") {
          if (!data.fileId) {
            throw new Error("File messages require a fileId.");
          }
          const file = await getFileMetadata(data.fileId);
          if (!file || file.userId !== user.id) {
            throw new Error("File not found or unauthorized.");
          }
        }

        if (data.replyToId) {
          const replyTo = await getMessageById(data.replyToId);
          if (!replyTo || replyTo.conversationId !== conversationId) {
            throw new Error("Reply target is not in this conversation.");
          }
        }

        // Dynamically ensure all online member sockets are joined to the conversation room
        if (conversationId !== "global") {
          try {
            const { db } = await import("../db/index.js");
            const { conversationMembers } = await import("../db/schema.js");
            const { eq } = await import("drizzle-orm");
            const membersList = await db.query.conversationMembers.findMany({
              where: eq(conversationMembers.conversationId, conversationId),
            });
            membersList.forEach((m) => {
              const sockets = getSocketsByUser(m.userId);
              sockets.forEach((sId) => {
                const s = io.sockets.sockets.get(sId);
                if (s) {
                  s.join(`room:${conversationId}`);
                }
              });
            });
          } catch (joinErr) {
            console.error("Failed to dynamically join member sockets to room:", joinErr);
          }
        }

        const msg = await createMessage({
          userId: user.id,
          conversationId,
          content: data.content,
          type: messageType,
          fileId: data.fileId || null,
          replyToId: data.replyToId || null,
        });

        // Broadcast new message strictly to conversation members room
        io.to(`room:${conversationId}`).emit("message:new", msg);
      } catch (err: any) {
        socket.emit("error", { message: err.message });
      }
    });

    // 3. Emoji reactions
    socket.on("message:react", async (data: { messageId: string; emoji: string; action: "add" | "remove" }) => {
      try {
        const now = Date.now();
        if (now - rateLimits.reaction < 500) {
          throw new Error("You are reacting too fast.");
        }
        rateLimits.reaction = now;

        if (!data || !data.messageId || !data.emoji || typeof data.emoji !== "string") {
          throw new Error("Invalid reaction format.");
        }

        // Extremely basic emoji length validation (handling surrogate pairs)
        if (data.emoji.length > 10) {
          throw new Error("Invalid emoji.");
        }

        const msg = await getMessageById(data.messageId);
        if (!msg) {
          throw new Error("Message not found.");
        }

        const hasAccess = await checkUserAccessToConversation(user.id, msg.conversationId);
        if (!hasAccess) {
          throw new Error("You do not have permission to react in this conversation.");
        }

        if (data.action === "add") {
          await addReaction(data.messageId, user.id, data.emoji);
        } else {
          await removeReaction(data.messageId, user.id, data.emoji);
        }

        // Get updated message to broadcast reactions update to room
        const updatedMsg = await getMessageById(data.messageId);
        if (updatedMsg) {
          io.to(`room:${msg.conversationId}`).emit("message:reactions_update", {
            messageId: data.messageId,
            reactions: updatedMsg.reactions,
          });
        }
      } catch (err: any) {
        socket.emit("error", { message: err.message });
      }
    });

    // 3b. Message deletion
    socket.on("message:delete", async (data: { messageId: string }) => {
      try {
        if (!data || !data.messageId) {
          throw new Error("Invalid delete request.");
        }

        const msg = await getMessageById(data.messageId);
        if (!msg) {
          throw new Error("Message not found.");
        }

        const hasAccess = await checkUserAccessToConversation(user.id, msg.conversationId);
        if (!hasAccess) {
          throw new Error("You do not have permission to delete messages in this conversation.");
        }

        await deleteMessage(data.messageId, user.id, user.isAdmin);

        // Broadcast deletion strictly to conversation members room
        io.to(`room:${msg.conversationId}`).emit("message:deleted", { messageId: data.messageId });
      } catch (err: any) {
        socket.emit("error", { message: err.message });
      }
    });

    // 3c. Message editing
    socket.on("message:edit", async (data: { messageId: string; content: string }) => {
      try {
        if (!data || !data.messageId || !data.content) {
          throw new Error("Invalid edit request.");
        }

        const msg = await getMessageById(data.messageId);
        if (!msg) {
          throw new Error("Message not found.");
        }

        const hasAccess = await checkUserAccessToConversation(user.id, msg.conversationId);
        if (!hasAccess) {
          throw new Error("You do not have permission to edit messages in this conversation.");
        }

        const updatedMsg = await editMessage(data.messageId, user.id, data.content, user.isAdmin);

        // Broadcast edit strictly to conversation members room
        io.to(`room:${msg.conversationId}`).emit("message:edited", { message: updatedMsg });
      } catch (err: any) {
        socket.emit("error", { message: err.message });
      }
    });

    // 3d. Clear chat history
    socket.on("message:clear_all", async () => {
      try {
        if (!user.isAdmin) {
          throw new Error("Only admins can clear chat.");
        }
        await clearAllMessages(user.id, user.isAdmin);
        io.emit("message:cleared_all");
      } catch (err: any) {
        socket.emit("error", { message: err.message });
      }
    });

    // 4. Typing indicators
    socket.on("typing:start", async (data?: { conversationId?: string }) => {
      const now = Date.now();
      if (now - rateLimits.typing < 500) return;
      rateLimits.typing = now;

      const conversationId = data?.conversationId || "global";
      if (!(await checkUserAccessToConversation(user.id, conversationId))) return;
      const typers = setTyping(conversationId, user.id, true);
      socket.to(`room:${conversationId}`).emit("typing:update", { conversationId, typers });
    });

    socket.on("typing:stop", async (data?: { conversationId?: string }) => {
      const conversationId = data?.conversationId || "global";
      if (!(await checkUserAccessToConversation(user.id, conversationId))) return;
      const typers = setTyping(conversationId, user.id, false);
      socket.to(`room:${conversationId}`).emit("typing:update", { conversationId, typers });
    });

    // 5. Voice Call webRTC signaling
    socket.on("voice:join", async (data?: { conversationId?: string }) => {
      const conversationId = data?.conversationId || "global";
      const hasAccess = await checkUserAccessToConversation(user.id, conversationId);
      if (!hasAccess) {
        socket.emit("error", { message: "You do not have permission to join this voice call." });
        socket.emit("voice:diagnostic-event", {
          level: "error",
          message: "Server rejected voice join: no access to this conversation.",
          conversationId,
          at: Date.now(),
        });
        return;
      }

      handleVoiceLeave(socketId, user);

      const participant: VoiceParticipant = {
        socketId,
        conversationId,
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
        avatarUrl: user.avatarUrl,
      };

      if (!voiceParticipantsByConversation.has(conversationId)) {
        voiceParticipantsByConversation.set(conversationId, new Map());
      }
      voiceParticipantsByConversation.get(conversationId)!.set(socketId, participant);

      // Notify others in call about new participant
      socket.to(`room:${conversationId}`).emit("voice:user-joined", participant);

      io.to(`room:${conversationId}`).emit("voice:update-participants", {
        conversationId,
        participants: getVoiceRoomParticipants(conversationId),
      });

      socket.emit("voice:joined", {
        conversationId,
        socketId,
        participants: getVoiceRoomParticipants(conversationId),
        rooms: Array.from(socket.rooms),
        at: Date.now(),
      });

    });

    socket.on("voice:leave", () => {
      handleVoiceLeave(socketId, user);
    });

    socket.on("voice:get-state", async (data?: { conversationId?: string }) => {
      const conversationId = data?.conversationId || "global";
      if (!(await checkUserAccessToConversation(user.id, conversationId))) return;
      socket.emit("voice:update-participants", {
        conversationId,
        participants: getVoiceRoomParticipants(conversationId),
      });
    });

    socket.on("voice:ping", (data: { sentAt?: number }, ack?: (response: { sentAt?: number; serverAt: number }) => void) => {
      if (typeof ack === "function") {
        ack({ sentAt: data?.sentAt, serverAt: Date.now() });
      }
    });

    socket.on("voice:diagnostics:get", async (data?: { conversationId?: string }) => {
      const requestedConversationId = data?.conversationId || findVoiceConversationBySocket(socketId) || "global";
      const hasAccess = await checkUserAccessToConversation(user.id, requestedConversationId);
      if (!hasAccess) return;

      socket.emit("voice:diagnostics:snapshot", {
        socketId,
        userId: user.id,
        requestedConversationId,
        activeVoiceConversationId: findVoiceConversationBySocket(socketId),
        socketRooms: Array.from(socket.rooms),
        participants: getVoiceRoomParticipants(requestedConversationId),
        allVoiceRooms: Array.from(voiceParticipantsByConversation.entries()).map(([conversationId, participants]) => ({
          conversationId,
          participantCount: participants.size,
          socketIds: Array.from(participants.keys()),
        })),
        at: Date.now(),
      });
    });

    // WebRTC signaling exchange
    socket.on("voice:signal", (data: { to: string; signal: any }) => {
      const conversationId = findVoiceConversationBySocket(socketId);
      if (!data?.to || !conversationId) return;
      const participants = voiceParticipantsByConversation.get(conversationId);
      if (!participants?.has(data.to)) return;
      // Relay signal to target socketId
      io.to(data.to).emit("voice:signal", {
        from: socketId,
        conversationId,
        signal: data.signal,
      });
    });

    // Server-relayed microphone frames. This is intentionally scoped to the
    // active voice room so audio keeps working even when WebRTC ICE cannot form
    // a direct peer path across mobile/home NATs.
    socket.on("voice:audio-frame", (data: {
      conversationId?: string;
      sampleRate?: number;
      channels?: number;
      sequence?: number;
      sentAt?: number;
      source?: "mic" | "tone";
      chunk?: ArrayBuffer | Buffer;
    }) => {
      try {
        const conversationId = findVoiceConversationBySocket(socketId);
        const emitStats = (participantsCount: number, reason?: string) => {
          const now = Date.now();
          if (reason || now - rateLimits.voiceLastStatsAt > 1000) {
            rateLimits.voiceLastStatsAt = now;
            socket.emit("voice:relay-stats", {
              conversationId,
              framesReceived: rateLimits.voiceFramesReceived,
              bytesReceived: rateLimits.voiceBytesReceived,
              droppedFrames: rateLimits.voiceDroppedFrames,
              recipients: Math.max(0, participantsCount - 1),
              reason,
              at: now,
            });
          }
        };

        if (!conversationId || (data?.conversationId && data.conversationId !== conversationId)) {
          rateLimits.voiceDroppedFrames++;
          socket.emit("voice:diagnostic-event", {
            level: "warn",
            message: "Server dropped audio frame because socket is not joined to that voice call.",
            conversationId: data?.conversationId,
            at: Date.now(),
          });
          return;
        }

        const participants = voiceParticipantsByConversation.get(conversationId);
        if (!participants?.has(socketId)) {
          rateLimits.voiceDroppedFrames++;
          emitStats(0, "not-a-participant");
          return;
        }

        const chunk = data?.chunk;
        const byteLength =
          Buffer.isBuffer(chunk) ? chunk.byteLength :
          chunk instanceof ArrayBuffer ? chunk.byteLength :
          ArrayBuffer.isView(chunk as any) ? (chunk as any).byteLength :
          0;

        if (!chunk || byteLength <= 0 || byteLength > MAX_VOICE_FRAME_BYTES) {
          rateLimits.voiceDroppedFrames++;
          emitStats(participants.size, "invalid-frame-size");
          return;
        }

        const sampleRate = Number(data.sampleRate) || 16000;
        const channels = Number(data.channels) || 1;
        if (sampleRate < 8000 || sampleRate > 48000 || channels !== 1) {
          rateLimits.voiceDroppedFrames++;
          emitStats(participants.size, "invalid-audio-format");
          return;
        }

        const now = Date.now();
        if (now - rateLimits.voiceAudioWindowStartedAt > VOICE_RATE_WINDOW_MS) {
          rateLimits.voiceAudioWindowStartedAt = now;
          rateLimits.voiceAudioBytes = 0;
        }
        rateLimits.voiceAudioBytes += byteLength;
        if (rateLimits.voiceAudioBytes > MAX_VOICE_BYTES_PER_WINDOW) {
          rateLimits.voiceDroppedFrames++;
          emitStats(participants.size, "rate-limited");
          return;
        }

        rateLimits.voiceFramesReceived++;
        rateLimits.voiceBytesReceived += byteLength;

        socket.to(`room:${conversationId}`).emit("voice:audio-frame", {
          from: socketId,
          conversationId,
          sampleRate,
          channels,
          sequence: data.sequence,
          sentAt: data.sentAt,
          source: data.source,
          chunk,
        });
        emitStats(participants.size);
      } catch (err) {
        console.warn("Failed to relay voice frame:", err);
        socket.emit("voice:diagnostic-event", {
          level: "error",
          message: "Server threw while relaying an audio frame.",
          at: Date.now(),
        });
      }
    });

    // 6. Handle Disconnect
    socket.on("disconnect", () => {
      // Clean up voice call if participant
      handleVoiceLeave(socketId, user);

      // Clean up presence
      const presenceResult = setOffline(socketId);
      if (presenceResult && presenceResult.wasLastSocket) {
        io.emit("presence:update", {
          userId: user.id,
          status: "offline",
          lastSeenAt: Date.now(),
        });
      }

      // Clean up typing
      const typers = setTyping("global", user.id, false);
      socket.to("room:global").emit("typing:update", { conversationId: "global", typers });
    });
  });

  function handleVoiceLeave(socketId: string, user: any) {
    const conversationId = findVoiceConversationBySocket(socketId);
    if (conversationId) {
      const participants = voiceParticipantsByConversation.get(conversationId);
      participants?.delete(socketId);
      if (participants?.size === 0) {
        voiceParticipantsByConversation.delete(conversationId);
      }

      // Notify others
      io.to(`room:${conversationId}`).emit("voice:user-left", {
        conversationId,
        socketId,
        userId: user.id,
      });

      // Emit updated list of active voice participants
      io.to(`room:${conversationId}`).emit("voice:update-participants", {
        conversationId,
        participants: getVoiceRoomParticipants(conversationId),
      });
    }
  }
}
