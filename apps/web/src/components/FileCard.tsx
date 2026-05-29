import { FileText, Image, Film, Music, Download } from "lucide-react";
import Button from "./Button.jsx";

interface FileCardProps {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export default function FileCard({ id, originalName, mimeType, sizeBytes }: FileCardProps) {
  // Format file size
  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Get icon based on mime type
  const getFileIcon = (mime: string) => {
    if (mime.startsWith("image/")) return <Image size={18} />;
    if (mime.startsWith("video/")) return <Film size={18} />;
    if (mime.startsWith("audio/")) return <Music size={18} />;
    return <FileText size={18} />;
  };

  const downloadUrl = `/api/files/${id}/${encodeURIComponent(originalName)}`;

  return (
    <div className="file-card">
      <div className="file-icon">
        {getFileIcon(mimeType)}
      </div>
      <div className="file-info">
        <div className="file-name" title={originalName}>
          {originalName}
        </div>
        <div className="file-size">{formatSize(sizeBytes)}</div>
      </div>
      <a href={downloadUrl} download={originalName} style={{ textDecoration: "none" }}>
        <Button variant="icon" aria-label={`Download ${originalName}`}>
          <Download size={16} />
        </Button>
      </a>
    </div>
  );
}
