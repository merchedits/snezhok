import { saveFileMetadata, getUploadFilePath, getFileMetadata } from "../services/files.js";
import { requireAuth } from "../lib/middleware.js";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { db } from "../db/index.js";
import { files } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const avatarsDir = path.resolve(__dirname, "../../../../data/uploads/avatars");
export async function fileRoutes(fastify) {
    // Init file upload
    fastify.post("/api/files/upload/init", { preHandler: [requireAuth] }, async (request, reply) => {
        const { originalName, mimeType, totalSize } = request.body;
        try {
            const fileRecord = await saveFileMetadata({
                userId: request.user.id,
                originalName,
                mimeType,
                sizeBytes: 0,
            });
            // Ensure empty file is created or just return the ID
            const writePath = getUploadFilePath(fileRecord.storedName);
            fs.writeFileSync(writePath, Buffer.alloc(0));
            return { success: true, fileId: fileRecord.id, file: fileRecord };
        }
        catch (error) {
            reply.status(400).send({ error: error.message });
        }
    });
    // Upload chunk
    fastify.post("/api/files/upload/chunk", { preHandler: [requireAuth] }, async (request, reply) => {
        if (!request.isMultipart()) {
            reply.status(400).send({ error: "Request must be multipart/form-data" });
            return;
        }
        try {
            const parts = request.parts();
            let fileId = null;
            let chunkIndex = null;
            let fileStream = null;
            for await (const part of parts) {
                if (part.type === "field" && part.fieldname === "fileId") {
                    fileId = part.value;
                }
                else if (part.type === "field" && part.fieldname === "chunkIndex") {
                    chunkIndex = Number(part.value);
                }
                else if (part.type === "file" && part.fieldname === "chunk") {
                    fileStream = part.file;
                    if (!fileId) {
                        reply.status(400).send({ error: "fileId must be provided before chunk" });
                        return;
                    }
                    const fileRecord = await getFileMetadata(fileId);
                    if (!fileRecord || fileRecord.userId !== request.user.id) {
                        reply.status(403).send({ error: "File not found or unauthorized" });
                        return;
                    }
                    const writePath = getUploadFilePath(fileRecord.storedName);
                    // Wait for file stream to pipe to append stream
                    await pipeline(fileStream, fs.createWriteStream(writePath, { flags: "a" }));
                }
            }
            return { success: true };
        }
        catch (error) {
            reply.status(400).send({ error: error.message });
        }
    });
    // Complete file upload
    fastify.post("/api/files/upload/complete", { preHandler: [requireAuth] }, async (request, reply) => {
        const { fileId, finalSize } = request.body;
        try {
            const fileRecord = await getFileMetadata(fileId);
            if (!fileRecord || fileRecord.userId !== request.user.id) {
                reply.status(403).send({ error: "File not found or unauthorized" });
                return;
            }
            const writePath = getUploadFilePath(fileRecord.storedName);
            const stats = fs.statSync(writePath);
            const sizeBytes = finalSize !== undefined ? finalSize : stats.size;
            await db
                .update(files)
                .set({ sizeBytes })
                .where(eq(files.id, fileRecord.id));
            fileRecord.sizeBytes = sizeBytes;
            return { success: true, file: fileRecord };
        }
        catch (error) {
            reply.status(400).send({ error: error.message });
        }
    });
    // Serve avatar
    fastify.get("/api/files/avatars/:filename", { preHandler: [requireAuth] }, async (request, reply) => {
        const { filename } = request.params;
        const filePath = path.join(avatarsDir, filename);
        if (!fs.existsSync(filePath)) {
            reply.status(404).send({ error: "Avatar not found" });
            return;
        }
        const ext = path.extname(filename).toLowerCase();
        let mimeType = "image/jpeg";
        if (ext === ".png")
            mimeType = "image/png";
        if (ext === ".gif")
            mimeType = "image/gif";
        if (ext === ".webp")
            mimeType = "image/webp";
        reply.type(mimeType);
        reply.header("Cache-Control", "public, max-age=86400");
        return reply.send(fs.createReadStream(filePath));
    });
    // Serve file
    fastify.get("/api/files/:id/:filename", { preHandler: [requireAuth] }, async (request, reply) => {
        const { id } = request.params;
        const file = await getFileMetadata(id);
        if (!file) {
            reply.status(404).send({ error: "File not found" });
            return;
        }
        const filePath = getUploadFilePath(file.storedName);
        if (!fs.existsSync(filePath)) {
            reply.status(404).send({ error: "File physical data not found" });
            return;
        }
        // Serve file stream
        reply.type(file.mimeType);
        // Support cache headers for static files/media
        reply.header("Cache-Control", "private, max-age=86400"); // 1 day cache
        // Prevent XSS from SVG/HTML by forcing download or at least safely handling it
        if (file.mimeType.includes("svg") || file.mimeType.includes("html") || file.mimeType.includes("xml")) {
            reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(file.originalName)}"`);
        }
        else {
            reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(file.originalName)}"`);
        }
        return reply.send(fs.createReadStream(filePath));
    });
}
