import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";

interface TextEntryModalProps {
  visible: boolean;
  title: string;
  placeholder: string;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}

export function TextEntryModal({ visible, title, placeholder, submitLabel, onClose, onSubmit }: TextEntryModalProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (visible) { setValue(""); setError(null); } }, [visible]);
  const submit = async () => {
    if (!value.trim() || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try { await onSubmit(value.trim()); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : t("requestFailed")); } finally { busyRef.current = false; setBusy(false); }
  };
  return (
    <Modal visible={visible} transparent animationType="fade" navigationBarTranslucent={false} onRequestClose={busy ? undefined : onClose}>
      <KeyboardAvoidingView style={[styles.overlay, { backgroundColor: palette.overlay, paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom + 4, 24) }]} behavior="height" automaticOffset>
        <View style={[styles.card, { backgroundColor: palette.elevated }]}> 
          <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
          <TextInput autoFocus autoCapitalize="none" value={value} onChangeText={setValue} placeholder={placeholder} placeholderTextColor={palette.faintText} onSubmitEditing={() => void submit()} style={[styles.input, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]} />
          {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
          <View style={styles.buttons}>
            <Pressable disabled={busy} onPress={onClose} style={styles.button}><Text style={[styles.buttonText, { color: palette.secondaryText }]}>{t("cancel")}</Text></Pressable>
            <Pressable disabled={!value.trim() || busy} onPress={() => void submit()} style={[styles.button, styles.primary, { backgroundColor: palette.accent, opacity: !value.trim() || busy ? 0.55 : 1 }]}>{busy ? <ActivityIndicator color="white" /> : <Text style={styles.primaryText}>{submitLabel}</Text>}</Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  card: { borderRadius: 16, padding: 18 },
  title: { fontSize: 19, fontWeight: "800" },
  input: { height: 48, borderWidth: 1, borderRadius: 10, marginTop: 16, paddingHorizontal: 13, fontSize: 16 },
  error: { fontSize: 12, marginTop: 8 },
  buttons: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 18 },
  button: { minWidth: 78, height: 42, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 14 },
  primary: { minWidth: 98 },
  buttonText: { fontSize: 14, fontWeight: "700" },
  primaryText: { color: "white", fontSize: 14, fontWeight: "700" },
});
