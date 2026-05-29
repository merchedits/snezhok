import { saveFileMetadata, getUploadFilePath, getFileMetadata } from "../services/files.js";
import { requireAuth } from "../lib/middleware.js";
import fs from "fs";
import { pipeline } from "stream/promises";
export async function fileRoutes(fastify) {
    // Upload file
    fastify.post("/api/files/upload", { preHandler: [requireAuth] }, async (request, reply) => {
        if (!request.isMultipart()) {
            reply.status(400).send({ error: "Request must be multipart/form-data" });
            return;
        }
        try {
            const parts = request.files();
            let fileRecord = null;
            for await (const part of parts) {
                if (part.type !== "file")
                    continue;
                // Save metadata first to get structured IDs and check whitelist
                fileRecord = await saveFileMetadata({
                    userId: request.user.id,
                    originalName: part.filename,
                    mimeType: part.mimetype,
                    sizeBytes: 0, // Will update size later or use as is
                });
                const writePath = getUploadFilePath(fileRecord.storedName);
                const writeStream = fs.createWriteStream(writePath);
                // Track bytes written
                let bytesWritten = 0;
                part.file.on("data", (chunk) => {
                    bytesWritten += chunk.length;
                });
                await pipeline(part.file, writeStream);
                // Update size in database
                // Wait, drizzle-orm update query
                const { db } = await import("../db/index.js");
                const { files } = await import("../db/schema.js");
                const { eq } = await import("drizzle-orm");
                await db
                    .update(files)
                    .set({ sizeBytes: bytesWritten })
                    .where(eq(files.id, fileRecord.id));
                fileRecord.sizeBytes = bytesWritten;
                break; // Support uploading one file per request for simplicity
            }
            if (!fileRecord) {
                reply.status(400).send({ error: "No file was uploaded." });
                return;
            }
            return { success: true, file: fileRecord };
        }
        catch (error) {
            // Limit errors or custom validation errors
            reply.status(400).send({ error: error.message });
        }
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
        return reply.send(fs.createReadStream(filePath));
    });
}
