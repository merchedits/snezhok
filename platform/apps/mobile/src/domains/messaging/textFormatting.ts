export type TextFormat = "bold" | "italic" | "mono" | "quote";

export function applyTextFormat(text: string, selection: { start: number; end: number }, format: TextFormat): { text: string; selection: { start: number; end: number } } {
  const start = Math.max(0, Math.min(text.length, Math.min(selection.start, selection.end)));
  const end = Math.max(start, Math.min(text.length, Math.max(selection.start, selection.end)));
  const selected = text.slice(start, end);
  if (format === "quote") {
    const value = selected.split("\n").map((line) => `> ${line}`).join("\n");
    return { text: `${text.slice(0, start)}${value}${text.slice(end)}`, selection: { start, end: start + value.length } };
  }
  const delimiter = format === "bold" ? "**" : format === "italic" ? "_" : "`";
  const value = `${delimiter}${selected}${delimiter}`;
  return { text: `${text.slice(0, start)}${value}${text.slice(end)}`, selection: { start: start + delimiter.length, end: start + delimiter.length + selected.length } };
}
