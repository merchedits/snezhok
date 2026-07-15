export function sanitizeDiagnosticValue(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[id]")
    .replace(/https?:\/\/[^\s/]+([^\s?#]*)[^\s]*/gi, "$1")
    .replace(/\b(?:password|token|secret|message|text)=([^\s&]+)/gi, "$1=[redacted]");
}
