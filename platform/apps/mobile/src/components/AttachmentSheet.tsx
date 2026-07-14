import { AppIcon, type AppIconName } from "./AppIcon";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { memo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import type { UploadInput } from "../types";

interface AttachmentSheetProps {
  visible: boolean;
  busy: boolean;
  progress?: number | null;
  onClose: () => void;
  onSelect: (input: UploadInput, messageKind?: "media" | "file" | "video-note") => Promise<void>;
}

export const AttachmentSheet = memo(function AttachmentSheet({ visible, busy, progress = null, onClose, onSelect }: AttachmentSheetProps) {
  const palette = usePalette();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [showMore, setShowMore] = useState(false);

  const pickMedia = async (quality: "auto" | "high") => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert(t("permissionPhotos"), t("allowPhotos"));
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: quality === "high" ? 0.92 : 0.72 });
    const asset = result.assets?.[0];
    if (!asset) return;
    await onSelect({ uri: asset.uri, filename: asset.fileName ?? `media-${Date.now()}`, mimeType: asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg"), kind: asset.type === "video" ? "video" : "image", quality, purpose: "standard" }, "media");
  };

  const pickOriginalFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    const asset = result.assets?.[0];
    if (!asset) return;
    await onSelect({ uri: asset.uri, filename: asset.name, mimeType: asset.mimeType ?? "application/octet-stream", kind: asset.mimeType?.startsWith("audio/") ? "audio" : asset.mimeType?.startsWith("video/") ? "video" : asset.mimeType?.startsWith("image/") ? "image" : "document", quality: "original", purpose: "standard", stripLocation: false }, "file");
  };

  const visibleProgress = Math.max(0, Math.min(100, progress ?? 0));

  return (
    <Modal transparent visible={visible} animationType="slide" navigationBarTranslucent={false} onRequestClose={onClose}>
      <Pressable onPress={busy ? undefined : onClose} style={[styles.overlay, { backgroundColor: palette.overlay }]}>
        <Pressable style={[styles.sheet, { backgroundColor: palette.elevated, paddingBottom: Math.max(insets.bottom + 4, 16) }]}>
          <View style={[styles.handle, { backgroundColor: palette.faintText }]} />
          <Text style={[styles.title, { color: palette.text }]}>{t("sendAttachment")}</Text>
          <View style={styles.actions}>
            <SheetAction icon="images-outline" label={t("photoVideoCompressed")} onPress={() => void pickMedia("auto")} disabled={busy} />
            <SheetAction icon="ellipsis-horizontal" label={t("moreSendingOptions")} onPress={() => setShowMore((value) => !value)} disabled={busy} expanded={showMore} />
            {showMore ? <View style={[styles.more, { borderTopColor: palette.border }]}>
              <SheetAction icon="sparkles-outline" label={t("sendAsHighQuality")} onPress={() => void pickMedia("high")} disabled={busy} />
              <SheetAction icon="document-outline" label={t("sendAsOriginalFile")} onPress={() => void pickOriginalFile()} disabled={busy} />
            </View> : null}
          </View>
          {busy ? <View style={styles.busy}>
            {progress === null ? <ActivityIndicator color={palette.accent} /> : <CircularProgress progress={visibleProgress} activeColor={palette.accent} inactiveColor={palette.border} textColor={palette.text} />}
            <Text style={[styles.busyText, { color: palette.secondaryText }]}>{progress === null ? t("preparingUpload") : t("uploadingProgress", { progress: visibleProgress })}</Text>
          </View> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
});

function SheetAction({ icon, label, onPress, disabled, expanded = false }: { icon: AppIconName; label: string; onPress: () => void; disabled: boolean; expanded?: boolean }) {
  const palette = usePalette();
  return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, { backgroundColor: pressed ? palette.surface : "transparent", opacity: disabled ? 0.45 : 1 }]}><View style={[styles.actionIcon, { backgroundColor: palette.accentSoft }]}><AppIcon name={icon} size={23} color={palette.accent} /></View><Text style={[styles.actionText, { color: palette.text }]}>{label}</Text><AppIcon name={expanded ? "chevron-up" : "chevron-forward"} size={19} color={palette.faintText} /></Pressable>;
}

const progressSegments = Array.from({ length: 24 }, (_, index) => index);

function CircularProgress({ progress, activeColor, inactiveColor, textColor }: { progress: number; activeColor: string; inactiveColor: string; textColor: string }) {
  const size = 52;
  const dot = 4;
  const radius = 22;
  const center = size / 2;
  const activeSegments = Math.round((progress / 100) * progressSegments.length);
  return <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress }} style={{ width: size, height: size }}>
    {progressSegments.map((segment) => {
      const angle = ((segment / progressSegments.length) * Math.PI * 2) - (Math.PI / 2);
      return <View key={segment} style={{ position: "absolute", width: dot, height: dot, borderRadius: dot / 2, left: center + Math.cos(angle) * radius - dot / 2, top: center + Math.sin(angle) * radius - dot / 2, backgroundColor: segment < activeSegments ? activeColor : inactiveColor }} />;
    })}
    <View style={styles.progressLabel}><Text style={[styles.progressText, { color: textColor }]}>{progress}%</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 9, paddingHorizontal: 14 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", opacity: 0.5 },
  title: { fontSize: 18, fontWeight: "800", marginTop: 14, marginHorizontal: 4 },
  actions: { marginTop: 10 },
  more: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4, paddingTop: 4 },
  action: { height: 58, borderRadius: 10, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, gap: 11 },
  actionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actionText: { flex: 1, fontSize: 16, fontWeight: "600" },
  busy: { minHeight: 72, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 8, gap: 12 },
  busyText: { fontSize: 13 },
  progressLabel: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  progressText: { fontSize: 10, fontWeight: "800", fontVariant: ["tabular-nums"] },
});
