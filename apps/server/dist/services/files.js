import { db } from "../db/index.js";
import { files } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Data upload folder at project root level
const uploadDir = path.resolve(__dirname, "../../../../data/uploads");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
export const ALLOWED_EXTENSIONS = [
    // Images
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
    // Audio
    ".mp3", ".wav", ".ogg", ".m4a", ".flac",
    // Video
    ".mp4", ".webm", ".mkv", ".mov",
    // Documents / Code
    ".pdf", ".txt", ".md", ".json", ".zip", ".tar", ".gz", ".rar", ".7z", ".pdf",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx"
];
export async function saveFileMetadata({ userId, originalName, mimeType, sizeBytes, }) {
    const ext = path.extname(originalName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        throw new Error(`File extension ${ext} is not allowed.`);
    }
    const fileId = nanoid();
    const storedName = `${fileId}${ext}`;
    const now = Date.now();
    const fileRecord = {
        id: fileId,
        userId,
        originalName,
        storedName,
        mimeType,
        sizeBytes,
        createdAt: now,
    };
    await db.insert(files).values(fileRecord);
    return fileRecord;
}
export function getUploadFilePath(storedName) {
    return path.join(uploadDir, storedName);
}
export async function getFileMetadata(fileId) {
    return await db.query.files.findFirst({
        where: eq(files.id, fileId),
    });
}
export async function deleteFileRecord(fileId) {
    const file = await getFileMetadata(fileId);
    if (!file)
        return;
    const fullPath = getUploadFilePath(file.storedName);
    if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
    }
    await db.delete(files).where(eq(files.id, fileId));
}
