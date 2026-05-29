import { useState } from "react";
import Modal from "./Modal.jsx";
import { Play } from "lucide-react";

interface VideoPreviewProps {
  id: string;
  originalName: string;
}

export default function VideoPreview({ id, originalName }: VideoPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);

  const fileUrl = `/api/files/${id}/${encodeURIComponent(originalName)}`;

  return (
    <>
      {/* Video Thumbnail Preview Card in Chat */}
      <div
        className="video-preview-bubble"
        onClick={() => setIsOpen(true)}
        title={`Click to play ${originalName}`}
        style={{
          marginTop: "6px",
          marginBottom: "6px",
          maxWidth: "100%",
          width: "360px",
          borderRadius: "16px",
          overflow: "hidden",
          border: "1px solid var(--color-border)",
          background: "#000",
          position: "relative",
          cursor: "pointer",
          aspectRatio: "16 / 9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}
      >
        {/* Render actual video as background thumbnail (first frame) */}
        <video
          src={fileUrl}
          preload="metadata"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.65
          }}
        />

        {/* Play Button Overlay */}
        <div style={{
          position: "absolute",
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: "var(--color-peach)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#FFFDF8",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          transition: "transform 0.2s, background 0.2s",
        }}
        className="video-play-btn"
        >
          <Play size={26} fill="#FFFDF8" style={{ marginLeft: "4px" }} />
        </div>
      </div>

      {/* Video Theater Mode Modal */}
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title={originalName} size="xl">
        <div style={{ 
          display: "flex", 
          justifyContent: "center", 
          alignItems: "center",
          background: "#000",
          borderRadius: "12px",
          overflow: "hidden",
          maxHeight: "75vh"
        }}>
          <video
            src={fileUrl}
            controls
            autoPlay
            playsInline
            style={{
              maxWidth: "100%",
              maxHeight: "75vh",
              objectFit: "contain",
              display: "block"
            }}
          />
        </div>
      </Modal>
    </>
  );
}
