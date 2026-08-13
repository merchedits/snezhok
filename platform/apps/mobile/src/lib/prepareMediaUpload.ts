import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

import type { UploadInput } from "../types";
import { replaceImageExtension, resizeForLongEdge } from "./mediaCompressionPolicy";

const AUTO_LONG_EDGE = 1_600;
const DATA_SAVER_LONG_EDGE = 1_280;

/**
 * Creates the lightweight photo that is actually staged for a normal send.
 * The original picker URI remains untouched; HQ/original uploads intentionally
 * bypass this path. Resizing before WorkManager staging prevents multi-megabyte
 * phone originals from consuming upload bandwidth and media-worker memory.
 */
export async function prepareMediaUpload(input: UploadInput): Promise<UploadInput> {
  if (input.kind !== "image" || input.quality === "high" || input.quality === "original") return input;
  const longEdge = input.quality === "data-saver" ? DATA_SAVER_LONG_EDGE : AUTO_LONG_EDGE;
  const resize = resizeForLongEdge(input.sourceWidth, input.sourceHeight, longEdge);
  const result = await manipulateAsync(input.uri, resize ? [{ resize }] : [], {
    compress: input.quality === "data-saver" ? 0.72 : 0.8,
    format: SaveFormat.JPEG,
  });
  return {
    ...input,
    uri: result.uri,
    filename: replaceImageExtension(input.filename, "jpg"),
    mimeType: "image/jpeg",
    stripLocation: true,
    sourceWidth: result.width,
    sourceHeight: result.height,
  };
}

export async function prepareMediaUploads(inputs: readonly UploadInput[]): Promise<UploadInput[]> {
  // Native image manipulation is memory-sensitive on low-end phones. Keep it
  // sequential; background uploads may run concurrently after bounded staging.
  const prepared: UploadInput[] = [];
  for (const input of inputs) prepared.push(await prepareMediaUpload(input));
  return prepared;
}
