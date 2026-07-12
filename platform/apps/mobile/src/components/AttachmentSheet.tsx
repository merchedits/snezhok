import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { UploadQuality } from "@snezhok/contracts";

import { usePalette } from "../hooks/usePalette";
import { useAppStore } from "../store/useAppStore";
import type { UploadInput } from "../types";

interface AttachmentSheetProps {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onSelect: (input: UploadInput, messageKind?: "media" | "file" | "video-note") => Promise<void>;
}

export function AttachmentSheet({ visible, busy, onClose, onSelect }: AttachmentSheetProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const defaultQuality = useAppStore((state) => state.settings.defaultUploadQuality);
  const [quality, setQuality] = useState<UploadQuality>(defaultQuality);

  const pickMedia = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert("Photos permission required", "Allow photo access to attach media.");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: quality === "original" ? 1 : quality === "high" ? 0.9 : quality === "data-saver" ? 0.45 : 0.72 });
    const asset = result.assets?.[0];
    if (!asset) return;
    await onSelect({ uri: asset.uri, filename: asset.fileName ?? `media-${Date.now()}`, mimeType: asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg"), kind: asset.type === "video" ? "video" : "image", quality }, "media");
  };

  const captureVideoNote = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return Alert.alert("Camera permission required", "Allow camera access to record a video message.");
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["videos"], videoMaxDuration: 60, quality: 0.75 });
    const asset = result.assets?.[0];
    if (!asset) return;
    await onSelect({ uri: asset.uri, filename: asset.fileName ?? `video-note-${Date.now()}.mp4`, mimeType: asset.mimeType ?? "video/mp4", kind: "video", quality }, "video-note");
  };

  const pickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    const asset = result.assets?.[0];
    if (!asset) return;
    await onSelect({ uri: asset.uri, filename: asset.name, mimeType: asset.mimeType ?? "application/octet-stream", kind: asset.mimeType?.startsWith("audio/") ? "audio" : asset.mimeType?.startsWith("video/") ? "video" : asset.mimeType?.startsWith("image/") ? "image" : "document", quality: "original" }, "file");
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={busy ? undefined : onClose} style={[styles.overlay, { backgroundColor: palette.overlay }]}>
        <Pressable style={[styles.sheet, { backgroundColor: palette.elevated, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={[styles.handle, { backgroundColor: palette.faintText }]} />
          <Text style={[styles.title, { color: palette.text }]}>Send attachment</Text>
          <Text style={[styles.label, { color: palette.secondaryText }]}>MEDIA QUALITY</Text>
          <View style={styles.qualities}>
            {(["data-saver", "auto", "high", "original"] as const).map((value) => <Pressable key={value} disabled={busy} onPress={() => setQuality(value)} style={[styles.quality, { borderColor: quality === value ? palette.accent : palette.border, backgroundColor: quality === value ? palette.accentSoft : palette.surface }]}><Text style={[styles.qualityText, { color: quality === value ? palette.accent : palette.secondaryText }]}>{value.replace("-", " ")}</Text></Pressable>)}
          </View>
          <View style={styles.actions}>
            <SheetAction icon="images-outline" label="Photo or video" onPress={() => void pickMedia()} disabled={busy} />
            <SheetAction icon="videocam-outline" label="Video message" onPress={() => void captureVideoNote()} disabled={busy} />
            <SheetAction icon="document-outline" label="File (original)" onPress={() => void pickFile()} disabled={busy} />
          </View>
          {busy ? <View style={styles.busy}><ActivityIndicator color={palette.accent} /><Text style={[styles.busyText, { color: palette.secondaryText }]}>Preparing upload…</Text></View> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetAction({ icon, label, onPress, disabled }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled: boolean }) {
  const palette = usePalette();
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, { backgroundColor: pressed ? palette.surface : "transparent", opacity: disabled ? 0.45 : 1 }]}><View style={[styles.actionIcon, { backgroundColor: palette.accentSoft }]}><Ionicons name={icon} size={23} color={palette.accent} /></View><Text style={[styles.actionText, { color: palette.text }]}>{label}</Text><Ionicons name="chevron-forward" size={19} color={palette.faintText} /></Pressable>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 9, paddingHorizontal: 14 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", opacity: 0.5 },
  title: { fontSize: 18, fontWeight: "800", marginTop: 14, marginHorizontal: 4 },
  label: { fontSize: 11, fontWeight: "800", marginTop: 18, marginHorizontal: 4 },
  qualities: { flexDirection: "row", gap: 6, marginTop: 8 },
  quality: { flex: 1, height: 34, borderWidth: 1, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  qualityText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  actions: { marginTop: 15 },
  action: { height: 58, borderRadius: 10, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, gap: 11 },
  actionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actionText: { flex: 1, fontSize: 16, fontWeight: "600" },
  busy: { height: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  busyText: { fontSize: 13 },
});
