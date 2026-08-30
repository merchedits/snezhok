export interface ImageGalleryItem {
  key: string;
  uri: string;
  filename: string;
  mimeType: string;
  kind?: "image" | "video";
  durationMs?: number | null;
}
