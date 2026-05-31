import { FastifyInstance } from "fastify";
import { saveFileMetadata, getUploadFilePath, getFileMetadata } from "../services/files.js";
import { requireAuth } from "../lib/middleware.js";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { db } from "../db/index.js";
import { files, messages } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "url";
import { Transform } from "stream";
import { checkUserAccessToConversation } from "../services/conversations.js";
import { config } from "../lib/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const avatarsDir = path.resolve(__dirname, "../../../../data/uploads/avatars");
const activeUploads = new Map<string, { userId: string; totalSize: number; ranges: Array<{ start: number; end: number }> }>();

async function userCanAccessFile(userId: string, fileId: string) {
  const file = await getFileMetadata(fileId);
  if (!file) return false;
  if (file.userId === userId) return true;

  const linkedMessages = await db.query.messages.findMany({
    where: eq(messages.fileId, fileId),
    columns: {
      conversationId: true,
    },
  });

  for (const msg of linkedMessages) {
    if (await checkUserAccessToConversation(userId, msg.conversationId)) {
      return true;
    }
  }

  return false;
}

function recordRange(fileId: string, start: number, length: number) {
  const upload = activeUploads.get(fileId);
  if (!upload) return;

  const end = start + length;
  upload.ranges.push({ start, end });
  upload.ranges.sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const range of upload.ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  upload.ranges = merged;
}

function hasCompleteCoverage(fileId: string, totalSize: number) {
  const upload = activeUploads.get(fileId);
  if (!upload) return false;
  return upload.ranges.length === 1 && upload.ranges[0].start === 0 && upload.ranges[0].end >= totalSize;
}

function validatePlainFilename(filename: string) {
  if (!filename || filename !== path.basename(filename) || filename.includes("..")) {
    throw new Error("Invalid filename.");
  }
}

export async function fileRoutes(fastify: FastifyInstance) {
  // Init file upload
  fastify.post(
    "/api/files/upload/init",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["originalName", "mimeType", "totalSize"],
          properties: {
            originalName: { type: "string", minLength: 1, maxLength: 255 },
            mimeType: { type: "string", minLength: 1, maxLength: 255 },
            totalSize: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (request: any, reply) => {
      const { originalName, mimeType, totalSize } = request.body;
      
      try {
        if (!Number.isSafeInteger(totalSize) || totalSize < 0) {
          throw new Error("Invalid total size.");
        }
        if (totalSize > config.MAX_FILE_SIZE) {
          throw new Error("File exceeds configured upload limit.");
        }

        const fileRecord = await saveFileMetadata({
          userId: request.user.id,
          originalName,
          mimeType,
          sizeBytes: 0,
        });
        
        // Ensure empty file is created or just return the ID
        const writePath = getUploadFilePath(fileRecord.storedName);
        fs.writeFileSync(writePath, Buffer.alloc(0));
        activeUploads.set(fileRecord.id, { userId: request.user.id, totalSize, ranges: [] });

        return { success: true, fileId: fileRecord.id, file: fileRecord };
      } catch (error: any) {
        reply.status(400).send({ error: error.message });
      }
    }
  );

  // Upload chunk
  fastify.post(
    "/api/files/upload/chunk",
    { preHandler: [requireAuth] },
    async (request: any, reply) => {
      if (!request.isMultipart()) {
        reply.status(400).send({ error: "Request must be multipart/form-data" });
        return;
      }

      try {
        const parts = request.parts();
        let fileId: string | null = null;
        let offset: number | null = null;

        for await (const part of parts) {
          if (part.type === "field" && part.fieldname === "fileId") {
            fileId = part.value;
          } else if (part.type === "field" && part.fieldname === "offset") {
            offset = Number(part.value);
          } else if (part.type === "file" && part.fieldname === "chunk") {
            const fileStream = part.file;
            if (!fileId) {
              reply.status(400).send({ error: "fileId must be provided before chunk" });
              return;
            }
            if (offset === null || !Number.isSafeInteger(offset) || offset < 0) {
              reply.status(400).send({ error: "offset must be provided before chunk" });
              return;
            }
            const chunkOffset: number = offset;
            const fileRecord = await getFileMetadata(fileId);
            if (!fileRecord || fileRecord.userId !== request.user.id) {
              reply.status(403).send({ error: "File not found or unauthorized" });
              return;
            }

            const upload = activeUploads.get(fileId);
            if (!upload || upload.userId !== request.user.id) {
              reply.status(400).send({ error: "Upload session not found. Please restart the upload." });
              return;
            }

            const writePath = getUploadFilePath(fileRecord.storedName);
            let bytesWritten = 0;
            const counter = new Transform({
              transform(chunk, _encoding, callback) {
                bytesWritten += chunk.length;
                callback(null, chunk);
              },
            });
            
            await pipeline(fileStream, counter, fs.createWriteStream(writePath, { flags: "r+", start: chunkOffset }));

            if (chunkOffset + bytesWritten > upload.totalSize) {
              throw new Error("Chunk writes past declared file size.");
            }
            recordRange(fileId, chunkOffset, bytesWritten);
          }
        }

        return { success: true };
      } catch (error: any) {
        reply.status(400).send({ error: error.message });
      }
    }
  );

  // Complete file upload
  fastify.post(
    "/api/files/upload/complete",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["fileId", "finalSize"],
          properties: {
            fileId: { type: "string", minLength: 1 },
            finalSize: { type: "integer", minimum: 0 },
          },
        },
      },
    },
    async (request: any, reply) => {
      const { fileId, finalSize } = request.body;

      try {
        const fileRecord = await getFileMetadata(fileId);
        if (!fileRecord || fileRecord.userId !== request.user.id) {
          reply.status(403).send({ error: "File not found or unauthorized" });
          return;
        }

        const writePath = getUploadFilePath(fileRecord.storedName);
        const stats = fs.statSync(writePath);
        const upload = activeUploads.get(fileId);
        const expectedSize = finalSize !== undefined ? Number(finalSize) : upload?.totalSize;
        
        if (expectedSize === undefined || !Number.isSafeInteger(expectedSize) || expectedSize < 0) {
          throw new Error("Invalid final size.");
        }
        const expectedSizeBytes: number = expectedSize;
        if (stats.size !== expectedSizeBytes) {
          throw new Error("Uploaded file size does not match the declared size.");
        }
        if (!hasCompleteCoverage(fileId, expectedSizeBytes)) {
          throw new Error("Upload is missing one or more chunks.");
        }

        await db
          .update(files)
          .set({ sizeBytes: stats.size })
          .where(eq(files.id, fileRecord.id));

        activeUploads.delete(fileId);
        fileRecord.sizeBytes = stats.size;

        return { success: true, file: fileRecord };
      } catch (error: any) {
        reply.status(400).send({ error: error.message });
      }
    }
  );

  // Serve avatar
  fastify.get(
    "/api/files/avatars/:filename",
    { preHandler: [requireAuth] },
    async (request: any, reply) => {
      const { filename } = request.params;
      try {
        validatePlainFilename(filename);
      } catch (error: any) {
        reply.status(400).send({ error: error.message });
        return;
      }
      const filePath = path.join(avatarsDir, filename);

      if (!fs.existsSync(filePath)) {
        reply.status(404).send({ error: "Avatar not found" });
        return;
      }

      const ext = path.extname(filename).toLowerCase();
      let mimeType = "image/jpeg";
      if (ext === ".png") mimeType = "image/png";
      if (ext === ".gif") mimeType = "image/gif";
      if (ext === ".webp") mimeType = "image/webp";

      reply.type(mimeType);
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.send(fs.createReadStream(filePath));
    }
  );

  // Serve file
  fastify.get(
    "/api/files/:id/:filename",
    { preHandler: [requireAuth] },
    async (request: any, reply) => {
      const { id } = request.params;
      const file = await getFileMetadata(id);

      if (!file) {
        reply.status(404).send({ error: "File not found" });
        return;
      }

      if (!(await userCanAccessFile(request.user.id, id))) {
        reply.status(403).send({ error: "You are not authorized to access this file." });
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
      } else {
        reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(file.originalName)}"`);
      }

      return reply.send(fs.createReadStream(filePath));
    }
  );
}
