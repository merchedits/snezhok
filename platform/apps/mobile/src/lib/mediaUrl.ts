export function resolveMediaUrl(uri: string, apiUrl: string): string {
  if (/^(?:https?|file|content|data|blob):/i.test(uri)) return uri;
  const apiMarker = apiUrl.indexOf("/api/v1");
  const deploymentBase = apiMarker >= 0 ? apiUrl.slice(0, apiMarker) : new URL(apiUrl).origin;
  return `${deploymentBase}${uri.startsWith("/") ? uri : `/${uri}`}`;
}
