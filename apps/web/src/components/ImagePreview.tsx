import { useState, useRef, useEffect } from "react";
import Modal from "./Modal.jsx";

interface ImagePreviewProps {
  id: string;
  originalName: string;
}

export default function ImagePreview({ id, originalName }: ImagePreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const fileUrl = `/api/files/${id}/${encodeURIComponent(originalName)}`;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isOpen) return;

    const onWheelEvent = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setZoom((prev) => Math.max(0.5, Math.min(prev + delta, 6)));
    };

    container.addEventListener("wheel", onWheelEvent, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheelEvent);
    };
  }, [isOpen]);

  const handleClose = () => {
    setIsOpen(false);
    setZoom(1);
    setPosition({ x: 0, y: 0 });
    setIsDragging(false);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only left click
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    e.preventDefault();
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

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

      <Modal isOpen={isOpen} onClose={handleClose} title={originalName} size="xl">
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            overflow: "hidden",
            cursor: isDragging ? "grabbing" : "grab",
            height: "70vh",
            background: "var(--color-bg-base)",
            borderRadius: "12px",
            position: "relative",
            userSelect: "none"
          }}
        >
          <img
            src={fileUrl}
            alt={originalName}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              borderRadius: "8px",
              pointerEvents: "none",
              transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
              transition: isDragging ? "none" : "transform 0.1s ease-out",
            }}
          />
        </div>
      </Modal>
    </>
  );
}
