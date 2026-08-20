export function isolatedContentComponentName(componentStack?: string | null): string {
  return componentStack?.match(/\bat ([A-Za-z][A-Za-z0-9_]*)\b/)?.[1]?.slice(0, 80) ?? "ContentComponent";
}
