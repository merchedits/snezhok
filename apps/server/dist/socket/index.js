import { validateSession } from "../services/auth.js";
import { setOnline, setOffline, setTyping } from "../services/presence.js";
import { createMessage, addReaction, removeReaction, getMessageById } from "../services/messages.js";
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
        // 2. Chat messaging events
        socket.on("message:send", async (data) => {
            try {
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
        // 4. Typing indicators
        socket.on("typing:start", () => {
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
            // Emit system message to chat log
            (async () => {
                try {
                    const sysMsg = await createMessage({
                        userId: user.id,
                        content: `joined the voice call`,
                        type: "system",
                    });
                    io.emit("message:new", sysMsg);
                }
                catch (err) { }
            })();
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
