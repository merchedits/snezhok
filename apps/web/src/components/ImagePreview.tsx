import { useState } from "react";
import Modal from "./Modal.jsx";

interface ImagePreviewProps {
  id: string;
  originalName: string;
}

export default function ImagePreview({ id, originalName }: ImagePreviewProps) {
  const [isOpen, setIsOpen] = useState(false);

  const fileUrl = `/api/files/${id}/${encodeURIComponent(originalName)}`;

  return (
    <>
      <div
        className="img-preview-bubble"
        onClick={() => setIsOpen(true)}
        title={`Click to enlarge ${originalName}`}
      >
        <img
          src={fileUrl}
          alt={originalName}
          loading="lazy"
        />
      </div>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title={originalName}>
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
          <img
            src={fileUrl}
            alt={originalName}
            style={{
              maxWidth: "100%",
              maxHeight: "70vh",
              objectFit: "contain",
              borderRadius: "8px",
            }}
          />
        </div>
      </Modal>
    </>
  );
}
