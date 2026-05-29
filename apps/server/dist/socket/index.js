import { validateSession } from "../services/auth.js";
import { setOnline, setOffline, setTyping } from "../services/presence.js";
import { createMessage, addReaction, removeReaction, getMessageById, deleteMessage, editMessage, clearAllMessages } from "../services/messages.js";
const voiceParticipants = new Map();
export function setupSocketIO(io) {
    // Authentication middleware
    io.use(async (socket, next) => {
        try {
            const cookieHeader = socket.handshake.headers.cookie;
            if (!cookieHeader) {
                return next(new Error("Authentication error: No cookies found"));
            }
            // Simple cookie parser
            const parsedCookies = Object.fromEntries(cookieHeader.split(";").map((c) => {
                const parts = c.trim().split("=");
                return [parts[0], parts.slice(1).join("=")];
            }));
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
        }
        catch (err) {
            next(new Error("Authentication error"));
        }
    });
    io.on("connection", (socket) => {
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
        // Rate limiting maps for this socket
        const rateLimits = {
            message: 0,
            reaction: 0,
            typing: 0,
        };
        // 2. Chat messaging events
        socket.on("message:send", async (data) => {
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
                const msg = await createMessage({
                    userId: user.id,
                    content: data.content,
                    type: data.type || "text",
                    fileId: data.fileId || null,
                    replyToId: data.replyToId || null,
                });
                // Broadcast new message to all clients
                io.emit("message:new", msg);
            }
            catch (err) {
                socket.emit("error", { message: err.message });
            }
        });
        // 3. Emoji reactions
        socket.on("message:react", async (data) => {
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
                if (data.action === "add") {
                    await addReaction(data.messageId, user.id, data.emoji);
                }
                else {
                    await removeReaction(data.messageId, user.id, data.emoji);
                }
                // Get updated message to broadcast reactions update
                const updatedMsg = await getMessageById(data.messageId);
                if (updatedMsg) {
                    io.emit("message:reactions_update", {
                        messageId: data.messageId,
                        reactions: updatedMsg.reactions,
                    });
                }
            }
            catch (err) {
                socket.emit("error", { message: err.message });
            }
        });
        // 3b. Message deletion
        socket.on("message:delete", async (data) => {
            try {
                if (!data || !data.messageId) {
                    throw new Error("Invalid delete request.");
                }
                await deleteMessage(data.messageId, user.id, user.isAdmin);
                // Broadcast deletion to all clients
                io.emit("message:deleted", { messageId: data.messageId });
            }
            catch (err) {
                socket.emit("error", { message: err.message });
            }
        });
        // 3c. Message editing
        socket.on("message:edit", async (data) => {
            try {
                if (!data || !data.messageId || !data.content) {
                    throw new Error("Invalid edit request.");
                }
                const updatedMsg = await editMessage(data.messageId, user.id, data.content, user.isAdmin);
                // Broadcast edit to all clients
                io.emit("message:edited", { message: updatedMsg });
            }
            catch (err) {
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
            }
            catch (err) {
                socket.emit("error", { message: err.message });
            }
        });
        // 4. Typing indicators
        socket.on("typing:start", () => {
            const now = Date.now();
            if (now - rateLimits.typing < 500)
                return;
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
            const participant = {
                socketId,
                userId: user.id,
                username: user.username,
                displayName: user.displayName,
                avatarColor: user.avatarColor,
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
        socket.on("voice:signal", (data) => {
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
    function handleVoiceLeave(socketId, user) {
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
