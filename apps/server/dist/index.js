import { fastify } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import { Server as SocketIOServer } from "socket.io";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { config } from "./lib/config.js";
import { db } from "./db/index.js";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
// Route modules
import { authRoutes } from "./routes/auth.js";
import { messageRoutes } from "./routes/messages.js";
import { fileRoutes } from "./routes/files.js";
import { userRoutes } from "./routes/users.js";
import { conversationRoutes } from "./routes/conversations.js";
// Socket setup
import { setupSocketIO } from "./socket/index.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ─── Database Migrations ──────────────────────────────────────────────────────
console.log("Running database migrations...");
try {
    const migrationsFolder = path.resolve(__dirname, "../drizzle");
    if (fs.existsSync(migrationsFolder)) {
        migrate(db, { migrationsFolder });
        console.log("Database migrations applied successfully!");
        // Bootstrap global conversation record for existing/default messages
        try {
            const { conversations } = await import("./db/schema.js");
            const { eq } = await import("drizzle-orm");
            const globalConv = await db.query.conversations.findFirst({
                where: eq(conversations.id, "global"),
            });
            if (!globalConv) {
                await db.insert(conversations).values({
                    id: "global",
                    type: "global",
                    createdAt: Date.now(),
                });
                console.log("🌸 Initialized global chat conversation in DB.");
            }
        }
        catch (bootstrapErr) {
            console.error("Failed to bootstrap global conversation:", bootstrapErr);
        }
    }
    else {
        console.log("Migrations folder not found, skipping startup migration.");
    }
}
catch (err) {
    console.error("Failed to run migrations on startup:", err);
}
// ─── Fastify App ──────────────────────────────────────────────────────────────
const app = fastify({
    logger: config.NODE_ENV === "development" ? {
        transport: {
            target: "pino-pretty",
            options: { translateTime: "HH:MM:ss Z", ignore: "pid,hostname" },
        },
    } : true,
});
// Configure plugins
await app.register(helmet, {
    contentSecurityPolicy: false, // Don't break React app for now
});
await app.register(rateLimit, {
    max: 500, // Default limit per minute
    timeWindow: "1 minute",
});
await app.register(cors, {
    origin: config.NODE_ENV === "development" ? "http://localhost:5173" : true,
    credentials: true,
});
await app.register(cookie);
await app.register(multipart, {
    limits: {
        fileSize: config.MAX_FILE_SIZE,
    },
});
// Register API routes
await app.register(authRoutes);
await app.register(messageRoutes);
await app.register(fileRoutes);
await app.register(userRoutes);
await app.register(conversationRoutes);
// Serve static frontend assets in production
const frontendDistPath = path.resolve(__dirname, "../../web/dist");
if (fs.existsSync(frontendDistPath)) {
    console.log("Serving static frontend files from:", frontendDistPath);
    await app.register(fastifyStatic, {
        root: frontendDistPath,
        prefix: "/",
        wildcard: false,
    });
    // SPA fallback: any non-API GET returns index.html
    app.setNotFoundHandler((request, reply) => {
        if (request.method === "GET" && !request.url.startsWith("/api/") && !request.url.startsWith("/socket.io")) {
            return reply.sendFile("index.html");
        }
        reply.status(404).send({ error: "Not found" });
    });
}
else {
    console.log("Frontend build folder not found. API mode only.");
}
// ─── Start Server, then attach Socket.io ──────────────────────────────────────
const start = async () => {
    try {
        // Let Fastify create and bind its internal HTTP server
        await app.listen({ port: config.PORT, host: config.HOST });
        // Attach Socket.io to Fastify's underlying HTTP server
        const io = new SocketIOServer(app.server, {
            cors: {
                origin: config.NODE_ENV === "development" ? "http://localhost:5173" : true,
                credentials: true,
            },
        });
        setupSocketIO(io);
        console.log(`🌸 Snezhok server is listening on http://${config.HOST}:${config.PORT}`);
        // Graceful shutdown
        const shutdown = async (signal) => {
            console.log(`\nReceived ${signal}. Shutting down gracefully...`);
            io.close(() => {
                console.log("Socket.io closed.");
            });
            await app.close();
            console.log("Fastify closed.");
            // Close database connection (ensure WAL checkpoint)
            import("./db/index.js").then(({ db }) => {
                // Better-sqlite3 client doesn't have an explicit async close in drizzle,
                // but we can close the underlying connection if needed, though process exit handles WAL on recent sqlite versions.
            });
            process.exit(0);
        };
        process.on("SIGINT", () => shutdown("SIGINT"));
        process.on("SIGTERM", () => shutdown("SIGTERM"));
    }
    catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};
start();
