export type Quality = "data-saver" | "auto" | "high" | "original";
export type MediaPurpose = "standard" | "voice" | "video-note";

export interface MediaJob {
  id: string;
  attachmentId: string;
  ownerId: string;
  profile: Quality;
  purpose: MediaPurpose;
  kind: "image" | "video" | "audio" | "document";
  originalMimeType: string;
  originalStorageKey: string;
  originalFilename: string;
  originalBytes: number;
  attempts: number;
  maxAttempts: number;
}

export interface OutputVariant {
  role: "primary" | "thumbnail";
  profile: string;
  path: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  waveform: number[] | null;
}
