import { lookup } from "node:dns/promises";
import https from "node:https";
import ipaddr from "ipaddr.js";

export interface LinkPreviewResult { url: string; hostname: string; title: string; description: string | null }

const MAX_HTML_BYTES = 256 * 1024;
const TIMEOUT_MS = 4_000;

export async function fetchSafeLinkPreview(value: string): Promise<LinkPreviewResult> {
  const url = parsePreviewUrl(value);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) throw new Error("LINK_PREVIEW_DESTINATION_BLOCKED");
  const target = addresses.find((entry) => entry.family === 4) ?? addresses[0]!;
  const html = await pinnedHttpsGet(url, target.address, target.family as 4 | 6);
  const title = metadata(html, "(?:property|name)=[\"']og:title[\"']", "content") ?? tagText(html, "title") ?? url.hostname;
  const description = metadata(html, "(?:property|name)=[\"'](?:og:description|description)[\"']", "content") ?? metadata(html, "name=[\"']description[\"']", "content");
  return { url: url.toString(), hostname: url.hostname, title: cleanText(title, 200) || url.hostname, description: description ? cleanText(description, 400) || null : null };
}

export function parsePreviewUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.hostname.endsWith(".") || url.hostname.length > 253) throw new Error("LINK_PREVIEW_URL_BLOCKED");
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  if (ipaddr.isValid(hostname) && !isPublicAddress(hostname)) throw new Error("LINK_PREVIEW_DESTINATION_BLOCKED");
  return url;
}

export function isPublicAddress(value: string): boolean {
  try { return ipaddr.parse(value).range() === "unicast"; }
  catch { return false; }
}

export function parsePreviewHtml(html: string, url = "https://example.com/"): LinkPreviewResult {
  const parsed = new URL(url);
  const title = metadata(html, "(?:property|name)=[\"']og:title[\"']", "content") ?? tagText(html, "title") ?? parsed.hostname;
  const description = metadata(html, "(?:property|name)=[\"'](?:og:description|description)[\"']", "content") ?? metadata(html, "name=[\"']description[\"']", "content");
  return { url: parsed.toString(), hostname: parsed.hostname, title: cleanText(title, 200) || parsed.hostname, description: description ? cleanText(description, 400) || null : null };
}

async function pinnedHttpsGet(url: URL, address: string, family: 4 | 6): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: url.hostname, port: 443, method: "GET", path: `${url.pathname}${url.search}`,
      family,
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "Snezhok-LinkPreview/1.0" },
      lookup: (_hostname, _options, callback) => callback(null, address, family),
      timeout: TIMEOUT_MS,
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400) { response.resume(); reject(new Error("LINK_PREVIEW_REDIRECT_BLOCKED")); return; }
      if (status < 200 || status >= 300 || !String(response.headers["content-type"] ?? "").toLowerCase().includes("text/html")) { response.resume(); reject(new Error("LINK_PREVIEW_UNSUPPORTED_RESPONSE")); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > MAX_HTML_BYTES) request.destroy(new Error("LINK_PREVIEW_TOO_LARGE")); else chunks.push(chunk); });
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("LINK_PREVIEW_TIMEOUT")));
    request.on("error", reject);
    request.end();
  });
}

function metadata(html: string, marker: string, attribute: string): string | null {
  const tags = html.slice(0, MAX_HTML_BYTES).match(/<meta\s+[^>]*>/giu) ?? [];
  const tag = tags.find((candidate) => new RegExp(marker, "iu").test(candidate));
  return tag ? attributeValue(tag, attribute) : null;
}

function attributeValue(tag: string, name: string): string | null { return new RegExp(`\\b${name}\\s*=\\s*[\"']([^\"']*)[\"']`, "iu").exec(tag)?.[1] ?? null; }
function tagText(html: string, name: string): string | null { return new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "iu").exec(html.slice(0, MAX_HTML_BYTES))?.[1] ?? null; }
function cleanText(value: string, limit: number): string { return decodeEntities(value.replace(/<[^>]+>/gu, " ")).replace(/\s+/gu, " ").trim().slice(0, limit); }
function decodeEntities(value: string): string { return value.replace(/&(?:amp|lt|gt|quot|#39);/gu, (entity) => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'" })[entity] ?? entity); }
