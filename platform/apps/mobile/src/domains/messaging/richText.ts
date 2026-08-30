export type RichTextMark = "bold" | "italic" | "mono" | "link";
export interface RichTextToken { text: string; marks: RichTextMark[]; url?: string }
export interface RichTextLine { quote: boolean; tokens: RichTextToken[] }

const URL = /^https?:\/\/[^\s<>{}\[\]"']+/iu;

export function parseRichText(input: string): RichTextLine[] {
  return input.split("\n").map((rawLine) => {
    const quote = /^\s*>\s?/u.test(rawLine);
    return { quote, tokens: inlineTokens(quote ? rawLine.replace(/^\s*>\s?/u, "") : rawLine) };
  });
}

function inlineTokens(input: string): RichTextToken[] {
  const tokens: RichTextToken[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const url = URL.exec(input.slice(cursor))?.[0];
    if (url) {
      const link = trimUrlPunctuation(url);
      tokens.push({ text: link, marks: ["link"], url: link });
      if (link.length < url.length) tokens.push({ text: url.slice(link.length), marks: [] });
      cursor += url.length;
      continue;
    }
    const marked = markedToken(input, cursor, "**", "bold") ?? markedToken(input, cursor, "_", "italic") ?? markedToken(input, cursor, "`", "mono");
    if (marked) { tokens.push(marked.token); cursor = marked.next; continue; }
    const next = nextSpecial(input, cursor + 1);
    tokens.push({ text: input.slice(cursor, next), marks: [] });
    cursor = next;
  }
  return tokens;
}

function markedToken(input: string, cursor: number, delimiter: string, mark: RichTextMark): { token: RichTextToken; next: number } | null {
  if (!input.startsWith(delimiter, cursor)) return null;
  const end = input.indexOf(delimiter, cursor + delimiter.length);
  if (end <= cursor + delimiter.length) return null;
  return { token: { text: input.slice(cursor + delimiter.length, end), marks: [mark] }, next: end + delimiter.length };
}

function nextSpecial(input: string, start: number): number {
  for (let index = start; index < input.length; index += 1) {
    if (input.startsWith("http://", index) || input.startsWith("https://", index) || input.startsWith("**", index) || input[index] === "_" || input[index] === "`") return index;
  }
  return input.length;
}

function trimUrlPunctuation(value: string): string { return value.replace(/[),.!?:;]+$/u, ""); }
