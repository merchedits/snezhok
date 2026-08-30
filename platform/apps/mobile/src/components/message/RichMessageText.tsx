import { Linking, StyleSheet, Text, View } from "react-native";

import { parseRichText } from "../../domains/messaging/richText";
import { usePalette } from "../../hooks/usePalette";

export function RichMessageText({ text, color, fontSize, lineHeight, inline = false }: { text: string; color: string; fontSize: number; lineHeight: number; inline?: boolean }) {
  const palette = usePalette();
  const lines = parseRichText(text);
  return <View style={inline ? styles.inline : undefined}>{lines.map((line, lineIndex) => <View key={lineIndex} style={[styles.line, line.quote && [styles.quote, { borderColor: palette.accent }]]}>
    <Text selectable={false} style={{ color, fontSize, lineHeight }}>{line.tokens.map((token, tokenIndex) => <Text
      key={tokenIndex}
      accessibilityRole={token.url ? "link" : undefined}
      onPress={token.url ? () => { void Linking.openURL(token.url!).catch(() => undefined); } : undefined}
      style={[
        token.marks.includes("bold") && styles.bold,
        token.marks.includes("italic") && styles.italic,
        token.marks.includes("mono") && [styles.mono, { backgroundColor: palette.surface }],
        token.marks.includes("link") && { color: palette.accent, textDecorationLine: "underline" },
      ]}
    >{token.text}</Text>)}</Text>
  </View>)}</View>;
}

const styles = StyleSheet.create({
  inline: { flexShrink: 1 }, line: { minWidth: 0 }, quote: { borderLeftWidth: 3, paddingLeft: 8, marginVertical: 2 },
  bold: { fontWeight: "800" }, italic: { fontStyle: "italic" }, mono: { fontFamily: "monospace", borderRadius: 4 },
});
