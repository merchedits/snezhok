export function sanitizeDiagnosticValue(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[id]")
    .replace(/https?:\/\/[^\s/]+([^\s?#]*)[^\s]*/gi, "$1")
    .replace(/\b(?:password|token|secret|message|text)=([^\s&]+)/gi, "$1=[redacted]");
}

export function sanitizeDiagnosticContext(input: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, rawValue] of Object.entries(input).slice(0, 20)) {
    const key = boundedDiagnosticText(rawKey, 48);
    if (/password|token|secret|messageText|body|stack|componentStack/i.test(key)) {
      output[key] = "[redacted]";
    } else if (/error|exception/i.test(key)) {
      output[key] = rawValue instanceof Error ? boundedDiagnosticText(rawValue.name, 80) : "[redacted]";
    } else if (typeof rawValue === "string") {
      output[key] = boundedDiagnosticText(rawValue, 160);
    } else if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      output[key] = rawValue;
    } else if (typeof rawValue === "boolean" || rawValue === null) {
      output[key] = rawValue;
    } else if (rawValue instanceof Error) {
      output[key] = boundedDiagnosticText(rawValue.name, 80);
    }
  }
  return output;
}

function boundedDiagnosticText(value: string, maxLength: number): string {
  return sanitizeDiagnosticValue(value).replace(/[\r\n\t]+/g, " ").trim().slice(0, maxLength) || "unknown";
}
