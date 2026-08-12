import type { ReactNode } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { usePalette } from "../../hooks/usePalette";
import { AppIcon, type AppIconName } from "../AppIcon";

export function ManagementModal({ visible, title, onClose, busy = false, children, right }: {
  visible: boolean; title: string; onClose: () => void; busy?: boolean; children: ReactNode; right?: ReactNode;
}) {
  const palette = usePalette();
  return <Modal visible={visible} animationType="slide" onRequestClose={busy ? undefined : onClose} statusBarTranslucent={false} navigationBarTranslucent={false}>
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.background }]} edges={["top", "bottom"]}>
      <View style={[styles.header, { borderColor: palette.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={busy} onPress={onClose} style={styles.headerButton}><AppIcon name="chevron-back" size={23} color={palette.accent} /></Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={[styles.title, { color: palette.text }]}>{title}</Text>
        <View style={styles.headerButton}>{busy ? <ActivityIndicator color={palette.accent} /> : right}</View>
      </View>
      {children}
    </SafeAreaView>
  </Modal>;
}

export function ManagementScroll({ children }: { children: ReactNode }) {
  return <KeyboardAwareScrollView bottomOffset={20} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</KeyboardAwareScrollView>;
}

export function ManagementSection({ title, children, footer }: { title?: string; children: ReactNode; footer?: string }) {
  const palette = usePalette();
  return <View style={styles.section}>{title ? <Text style={[styles.sectionTitle, { color: palette.secondaryText }]}>{title}</Text> : null}<View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>{children}</View>{footer ? <Text style={[styles.footer, { color: palette.secondaryText }]}>{footer}</Text> : null}</View>;
}

export function ManagementRow({ icon, label, detail, value, destructive = false, disabled = false, onPress, trailing }: {
  icon: AppIconName; label: string; detail?: string; value?: string; destructive?: boolean; disabled?: boolean; onPress?: () => void; trailing?: ReactNode;
}) {
  const palette = usePalette();
  const color = destructive ? palette.danger : palette.accent;
  return <Pressable accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={label} disabled={disabled || !onPress} onPress={onPress} style={({ pressed }) => [styles.row, { borderColor: palette.border, opacity: disabled ? 0.45 : pressed ? 0.65 : 1 }]}>
    <View style={[styles.icon, { backgroundColor: destructive ? `${palette.danger}1a` : palette.accentSoft }]}><AppIcon name={icon} size={20} color={color} /></View>
    <View style={styles.copy}><Text numberOfLines={1} style={[styles.label, { color: destructive ? palette.danger : palette.text }]}>{label}</Text>{detail ? <Text numberOfLines={2} style={[styles.detail, { color: palette.secondaryText }]}>{detail}</Text> : null}</View>
    {value ? <Text numberOfLines={1} style={[styles.value, { color: palette.secondaryText }]}>{value}</Text> : null}
    {trailing ?? (onPress ? <AppIcon name="chevron-forward" size={17} color={palette.faintText} /> : null)}
  </Pressable>;
}

export function ManagementEmpty({ text }: { text: string }) { const palette = usePalette(); return <Text style={[styles.empty, { color: palette.secondaryText }]}>{text}</Text>; }

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { height: 54, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth }, headerButton: { width: 54, height: 54, alignItems: "center", justifyContent: "center" }, title: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "800" },
  content: { paddingBottom: 30 }, section: { marginTop: 18, marginHorizontal: 12 }, sectionTitle: { marginHorizontal: 10, marginBottom: 7, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.45 }, card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, overflow: "hidden" }, footer: { fontSize: 12, lineHeight: 17, marginHorizontal: 10, marginTop: 7 },
  row: { minHeight: 58, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 11, borderBottomWidth: StyleSheet.hairlineWidth }, icon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" }, copy: { flex: 1, paddingVertical: 9 }, label: { fontSize: 15, fontWeight: "600" }, detail: { fontSize: 12, lineHeight: 16, marginTop: 2 }, value: { maxWidth: "32%", fontSize: 13 }, empty: { textAlign: "center", padding: 36, fontSize: 14 },
});

export const managementStyles = styles;
