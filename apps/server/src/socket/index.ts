import { Server, Socket } from "socket.io";
import { validateSession } from "../services/auth.js";
import { setOnline, setOffline, setTyping, getTypers, getSocketsByUser } from "../services/presence.js";
import { createMessage, addReaction, removeReaction, getMessageById, deleteMessage, editMessage, clearAllMessages } from "../services/messages.js";
import { getUserConversations, checkUserAccessToConversation } from "../services/conversations.js";

// In-memory set of voice call participants: socketId -> user details
interface VoiceParticipant {
  socketId: string;
  userId: string;
  username: string;
  displayName: string;
  avatarColor: string;
  avatarUrl?: string | null;
}
const voiceParticipants = new Map<string, VoiceParticipant>();

export function setupSocketIO(io: Server) {
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
          return [parts[0], parts.slice(1).join("=")];
        })
      );

      const sessionId = parsedCookies["sessionId"];
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
      voiceParticipants: Array.from(voiceParticipants.values()),
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
    socket.on("room:join", (data: { conversationId: string }) => {
      if (data && data.conversationId) {
        socket.join(`room:${data.conversationId}`);
      }
    });

    // Rate limiting maps for this socket
    const rateLimits = {
      message: 0,
      reaction: 0,
      typing: 0,
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
          type: data.type || "text",
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
    socket.on("typing:start", () => {
      const now = Date.now();
      if (now - rateLimits.typing < 500) return;
      rateLimits.typing = now;

      const typers = setTyping("global", user.id, true);
      socket.broadcast.emit("typing:update", { typers });
    });

    socket.on("typing:stop", () => {
      const typers = setTyping("global", user.id, false);
      socket.broadcast.emit("typing:update", { typers });
    });

    // 5. Voice Call webRTC signaling
    socket.on("voice:join", () => {
      const participant: VoiceParticipant = {
        socketId,
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarColor: user.avatarColor,
        avatarUrl: user.avatarUrl,
      };

      voiceParticipants.set(socketId, participant);

      // Notify others in call about new participant
      socket.broadcast.emit("voice:user-joined", participant);

      // Emit global update of active voice participants list
      io.emit("voice:update-participants", Array.from(voiceParticipants.values()));

    });

    socket.on("voice:leave", () => {
      handleVoiceLeave(socketId, user);
    });

    // WebRTC signaling exchange
    socket.on("voice:signal", (data: { to: string; signal: any }) => {
      // Relay signal to target socketId
      io.to(data.to).emit("voice:signal", {
        from: socketId,
        signal: data.signal,
      });
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
      socket.broadcast.emit("typing:update", { typers });
    });
  });

  function handleVoiceLeave(socketId: string, user: any) {
    if (voiceParticipants.has(socketId)) {
      voiceParticipants.delete(socketId);

      // Notify others
      io.emit("voice:user-left", {
        socketId,
        userId: user.id,
      });

      // Emit updated list of active voice participants
      io.emit("voice:update-participants", Array.from(voiceParticipants.values()));
    }
  }
}
