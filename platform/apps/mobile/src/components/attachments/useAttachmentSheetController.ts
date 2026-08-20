import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated } from "react-native";

import { deviceMediaUseCases, type DeviceMediaAsset } from "../../application/attachments/deviceMediaUseCases";
import { useTranslation } from "../../i18n";
import { userFacingError } from "../../lib/userFacingError";
import type { UploadInput } from "../../types";
import { useAppDialog } from "../AppDialogProvider";

export type DrawerItem = { type: "upload"; id: "upload-file" } | { type: "camera"; id: "camera" } | { type: "asset"; id: string; asset: DeviceMediaAsset };
const UPLOAD_ITEM: DrawerItem = { type: "upload", id: "upload-file" };
const CAMERA_ITEM: DrawerItem = { type: "camera", id: "camera" };

export function useAttachmentSheetController(input: {
  visible: boolean;
  busy: boolean;
  imagesOnly: boolean;
  onSelect: (inputs: UploadInput[], messageKind?: "media" | "file" | "video-note") => Promise<void>;
}) {
  const { visible, busy, imagesOnly, onSelect } = input;
  const { t } = useTranslation();
  const showDialog = useAppDialog();
  const [assets, setAssets] = useState<DeviceMediaAsset[]>(deviceMediaUseCases.cachedRecent());
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(false);
  const [quality, setQuality] = useState<"auto" | "high">("auto");
  const [qualityNotice, setQualityNotice] = useState<string | null>(null);
  const noticeOpacity = useRef(new Animated.Value(0)).current;
  const noticeAnimationRef = useRef<ReturnType<typeof Animated.sequence> | null>(null);

  const refreshAssets = useCallback(async () => {
    setLoading(true);
    try {
      const result = await deviceMediaUseCases.recentAssets(imagesOnly);
      if (result.status === "permission-denied") showDialog(t("permissionPhotos"), t("allowPhotos"));
      if (result.status === "selected") setAssets(result.value);
    } catch (error) {
      showDialog(t("requestFailed"), userFacingError(error, t));
    } finally {
      setLoading(false);
    }
  }, [imagesOnly, showDialog, t]);

  useEffect(() => {
    if (!visible) return;
    setQuality("auto");
    noticeAnimationRef.current?.stop();
    noticeOpacity.setValue(0);
    setQualityNotice(null);
    setSelectedIds([]);
    setResolving(false);
    resolvingRef.current = false;
    void refreshAssets();
  }, [noticeOpacity, refreshAssets, visible]);

  useEffect(() => () => noticeAnimationRef.current?.stop(), []);

  const toggleHighQuality = useCallback(() => {
    if (busy || resolving) return;
    const nextQuality = quality === "high" ? "auto" : "high";
    setQuality(nextQuality);
    setQualityNotice(t(nextQuality === "high" ? "hqEnabled" : "hqDisabled"));
    noticeAnimationRef.current?.stop();
    noticeOpacity.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(noticeOpacity, { toValue: 1, duration: 130, useNativeDriver: true }),
      Animated.delay(1_250),
      Animated.timing(noticeOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]);
    noticeAnimationRef.current = animation;
    animation.start(({ finished }) => {
      if (finished) setQualityNotice(null);
    });
  }, [busy, noticeOpacity, quality, resolving, t]);

  const pickOriginalFile = useCallback(async () => {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    try {
      const result = await deviceMediaUseCases.pickOriginal();
      if (result.status === "selected") await onSelect(result.value.inputs, result.value.messageKind);
    } catch (error) {
      showDialog(t("uploadFailed"), userFacingError(error, t));
    } finally {
      resolvingRef.current = false;
    }
  }, [onSelect, showDialog, t]);

  const capturePhoto = useCallback(async () => {
    if (busy || resolvingRef.current) return;
    resolvingRef.current = true;
    setResolving(true);
    try {
      const result = await deviceMediaUseCases.capturePhoto(quality);
      if (result.status === "permission-denied") showDialog(t("permissionCamera"), t("allowCameraPhoto"));
      if (result.status === "selected") await onSelect(result.value.inputs, result.value.messageKind);
    } catch (error) {
      showDialog(t("uploadFailed"), userFacingError(error, t));
    } finally {
      resolvingRef.current = false;
      setResolving(false);
    }
  }, [busy, onSelect, quality, showDialog, t]);

  const toggleRecentAsset = useCallback((asset: DeviceMediaAsset) => {
    if (busy || resolving) return;
    setSelectedIds((current) => current.includes(asset.id) ? current.filter((id) => id !== asset.id) : [...current, asset.id]);
  }, [busy, resolving]);

  const sendSelection = useCallback(async () => {
    if (!selectedIds.length || busy || resolvingRef.current) return;
    resolvingRef.current = true;
    setResolving(true);
    try {
      await onSelect(await deviceMediaUseCases.resolveAssets(selectedIds, quality), "media");
    } catch (error) {
      showDialog(t("uploadFailed"), userFacingError(error, t));
    } finally {
      resolvingRef.current = false;
      setResolving(false);
    }
  }, [busy, onSelect, quality, selectedIds, showDialog, t]);

  const items = useMemo<DrawerItem[]>(() => [
    ...(imagesOnly ? [] : [UPLOAD_ITEM]),
    CAMERA_ITEM,
    ...assets.filter((asset) => !imagesOnly || asset.mediaType === "image").map((asset) => ({ type: "asset" as const, id: asset.id, asset })),
  ], [assets, imagesOnly]);

  return { items, loading, selectedIds, resolving, quality, qualityNotice, noticeOpacity, toggleHighQuality, pickOriginalFile, capturePhoto, toggleRecentAsset, sendSelection };
}
