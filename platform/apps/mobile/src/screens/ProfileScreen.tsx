import { AppIcon } from "../components/AppIcon";
import { AuthenticatedImage } from "../components/AuthenticatedImage";
import * as ImagePicker from "expo-image-picker";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ProfilePhoto, UserProfile } from "@snezhok/contracts";

import { peopleUseCases } from "../application/people/peopleUseCases";
import { profileUseCases } from "../application/profile/profileUseCases";
import { Avatar } from "../components/Avatar";
import { useAppDialog } from "../components/AppDialogProvider";
import { ScreenHeader } from "../components/ScreenHeader";
import { PlayfulBackdrop } from "../components/PlayfulBackdrop";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { userFacingError } from "../lib/userFacingError";
import { useAppStore } from "../store/useAppStore";
import type { RootStackParamList } from "../types";
import { ImageGalleryViewer, type ImageGalleryItem } from "../components/ImageViewer";

interface ProfileScreenProps { embedded?: boolean; active?: boolean; userId?: string; onBack?: () => void }

export function PublicProfileScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, "Profile">) {
  return <ProfileScreen userId={route.params.userId} onBack={navigation.goBack} />;
}

export function ProfileScreen({ embedded = false, active = true, userId, onBack }: ProfileScreenProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { width: viewportWidth } = useWindowDimensions();
  const showDialog = useAppDialog();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const me = useAppStore((state) => state.me);
  const friends = useAppStore((state) => state.friends);
  const conversations = useAppStore((state) => state.conversations);
  const applyConversation = useAppStore((state) => state.applyConversation);
  const refreshBootstrap = useAppStore((state) => state.refreshBootstrap);
  const targetId = userId ?? me?.id;
  const own = Boolean(me && targetId === me.id);
  const [profile, setProfile] = useState<UserProfile | null>(me && own ? { user: me, photos: [] } : null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(me?.displayName ?? "");
  const [bio, setBio] = useState(me?.bio ?? "");
  const [photoMenuVisible, setPhotoMenuVisible] = useState(false);
  const [photoUploadProgress, setPhotoUploadProgress] = useState<{ completed: number; total: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active || !targetId) return;
    let mounted = true;
    const timer = setTimeout(() => {
      void profileUseCases.load(targetId).then((next) => {
        if (!mounted) return;
        setProfile(next);
        setDisplayName(next.user.displayName);
        setBio(next.user.bio);
        setSelectedPhotoId(null);
      }).catch((error) => {
        if (mounted && !profile) showDialog(t("profileLoadFailed"), userFacingError(error, t));
      });
    }, embedded ? 220 : 0);
    return () => { mounted = false; clearTimeout(timer); };
  }, [active, embedded, targetId]);

  const selectedPhoto = profile?.photos.find((photo) => photo.id === selectedPhotoId) ?? profile?.photos[0];
  const selectedPhotoIndex = Math.max(0, profile?.photos.findIndex((photo) => photo.id === selectedPhoto?.id) ?? 0);
  const heroWidth = Math.min(560, Math.max(280, viewportWidth - 24));
  const contactEntries = useMemo(() => own ? friends.filter((entry) => entry.relationship === "friend") : [], [friends, own]);

  const saveProfile = async () => {
    if (!displayName.trim() || busy) return;
    setBusy(true);
    try {
      const user = await profileUseCases.update({ displayName, bio });
      setProfile((current) => current ? { ...current, user } : { user, photos: [] });
      await refreshBootstrap();
      setEditing(false);
    } catch (error) {
      showDialog(t("profileSaveFailed"), userFacingError(error, t));
    } finally { setBusy(false); }
  };

  const addPhotos = async () => {
    if (busy) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return showDialog(t("permissionPhotos"), t("allowPhotos"));
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsMultipleSelection: true,
      orderedSelection: true,
      selectionLimit: 10,
    });
    const assets = result.assets ?? [];
    if (assets.length === 0) return;
    setPhotoMenuVisible(false);
    setBusy(true);
    setPhotoUploadProgress({ completed: 0, total: assets.length });
    try {
      let next = profile;
      let newestPhotoId: string | null = null;
      for (const [index, asset] of assets.entries()) {
        const existingIds = new Set(next?.photos.map((photo) => photo.id) ?? []);
        next = await profileUseCases.addPhoto({
          uri: asset.uri,
          filename: asset.fileName ?? `profile-${Date.now()}-${index + 1}.jpg`,
          mimeType: asset.mimeType ?? "image/jpeg",
          kind: "image",
          quality: "high",
        });
        newestPhotoId = next.photos.find((photo) => !existingIds.has(photo.id))?.id ?? newestPhotoId;
        setProfile(next);
        setPhotoUploadProgress({ completed: index + 1, total: assets.length });
      }
      setSelectedPhotoId(newestPhotoId);
      await refreshBootstrap();
    } catch (error) {
      showDialog(t("uploadFailed"), userFacingError(error, t));
    } finally {
      setPhotoUploadProgress(null);
      setBusy(false);
    }
  };

  const makePrimary = async (photo: ProfilePhoto) => {
    if (!own || !profile || profile.photos[0]?.id === photo.id || busy) return;
    setBusy(true);
    try {
      const next = await profileUseCases.makePrimary(profile, photo);
      setProfile(next); setSelectedPhotoId(null);
      await refreshBootstrap();
    } catch (error) { showDialog(t("profileSaveFailed"), userFacingError(error, t)); }
    finally { setBusy(false); }
  };

  const confirmDelete = (photo: ProfilePhoto) => showDialog(t("deletePhoto"), t("deletePhotoConfirm"), [
    { text: t("cancel"), style: "cancel" },
    { text: t("deletePhoto"), style: "destructive", onPress: () => void removePhoto(photo.id) },
  ]);

  const removePhoto = async (photoId: string) => {
    setBusy(true);
    try {
      const next = await profileUseCases.removePhoto(photoId);
      setProfile(next); setSelectedPhotoId(null);
      await refreshBootstrap();
    } catch (error) { showDialog(t("profileSaveFailed"), userFacingError(error, t)); }
    finally { setBusy(false); }
  };

  const openChat = async () => {
    if (!profile) return;
    try {
      const { conversation, created } = await peopleUseCases.openDirect(conversations, profile.user.id);
      if (created) applyConversation(conversation);
      navigation.navigate("Chat", { streamId: conversation.id, streamKind: "conversation", title: conversation.title });
    } catch (error) { showDialog(t("openChatFailed"), userFacingError(error, t)); }
  };

  const openContact = (contactId: string) => navigation.navigate("Profile", { userId: contactId });

  if (!profile) return <View style={[styles.loading, { backgroundColor: palette.background }]}><ActivityIndicator color={palette.accent} /></View>;
  const user = profile.user;

  return (
    <View style={[styles.screen, { backgroundColor: palette.profileCanvas }]}>
      <PlayfulBackdrop variant="profile" />
      <ScreenHeader
        tone="profile"
        prominent={embedded}
        title={t("profile")}
        {...(!embedded && onBack ? { left: { icon: "chevron-back" as const, label: t("back"), onPress: onBack } } : {})}
        right={own
          ? editing
            ? [{ icon: "checkmark", label: t("save"), onPress: () => void saveProfile() }]
            : [
                { icon: "create-outline", label: t("editProfile"), onPress: () => setEditing(true) },
                { icon: "ellipsis-horizontal", label: t("more"), onPress: () => setPhotoMenuVisible(true) },
              ]
          : []}
      />
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={[styles.content, !embedded && { paddingBottom: Math.max(insets.bottom + 16, 34) }]} keyboardShouldPersistTaps="handled">
        <View style={[styles.hero, { width: heroWidth, backgroundColor: palette.surface, borderColor: palette.border }]}>
          {profile.photos.length > 0 ? (
            <ScrollView
              horizontal
              pagingEnabled
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              onMomentumScrollEnd={(event) => {
                const index = Math.max(0, Math.min(profile.photos.length - 1, Math.round(event.nativeEvent.contentOffset.x / heroWidth)));
                setSelectedPhotoId(profile.photos[index]?.id ?? null);
              }}
            >
              {profile.photos.map((photo, index) => (
                <Pressable key={photo.id} accessibilityRole="imagebutton" onPress={() => setViewerIndex(index)} style={[styles.heroPage, { width: heroWidth }]}>
                  <AuthenticatedImage uri={photo.url} fallbackUri={photo.thumbnailUrl} cacheKey={`${photo.id}-profile-hero`} mimeType="image/jpeg" resizeMode="cover" style={StyleSheet.absoluteFill} />
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <View style={[styles.heroFallback, { backgroundColor: palette.group.lime }]}>
              <Avatar uri={user.avatarUrl} label={user.displayName} color={user.avatarColor} online={user.presence === "online"} size={150} />
            </View>
          )}
          {profile.photos.length > 1 ? (
            <View style={styles.photoCounter}><Text style={styles.photoCounterText}>{selectedPhotoIndex + 1}/{profile.photos.length}</Text></View>
          ) : null}
        </View>
        {editing ? <View style={[styles.form, { backgroundColor: palette.elevated, borderColor: palette.border }]}>
          <ProfileInput label={t("displayName")} value={displayName} onChangeText={setDisplayName} maxLength={48} />
          <ProfileInput label={t("bio")} value={bio} onChangeText={setBio} maxLength={512} multiline />
          <Pressable disabled={busy || !displayName.trim()} onPress={() => void saveProfile()} style={[styles.primaryButton, { backgroundColor: palette.accent, borderColor: palette.border, opacity: busy || !displayName.trim() ? 0.55 : 1 }]}>{busy ? <ActivityIndicator color={palette.onAccent} /> : <Text style={[styles.primaryButtonText, { color: palette.onAccent }]}>{t("save")}</Text>}</Pressable>
        </View> : <View style={[styles.identity, { backgroundColor: palette.elevated, borderColor: palette.border }]}>
          <Text style={[styles.name, { color: palette.text }]}>{user.displayName}</Text>
          <Text style={[styles.username, { color: palette.secondaryText }]}>@{user.username}</Text>
          {user.bio ? <Text style={[styles.bio, { color: palette.text }]}>{user.bio}</Text> : null}
        </View>}
        {!own ? <Pressable onPress={() => void openChat()} style={[styles.primaryButton, { backgroundColor: palette.accent, borderColor: palette.border }]}><AppIcon name="chatbubble-outline" size={18} color={palette.onAccent} /><Text style={[styles.primaryButtonText, { color: palette.onAccent }]}>{t("messageUser")}</Text></Pressable> : null}

        {own && contactEntries.length > 0 ? <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>{t("contacts")}</Text>
          {contactEntries.map((entry) => <Pressable key={entry.user.id} onPress={() => openContact(entry.user.id)} style={[styles.contact, { backgroundColor: palette.surface, borderColor: palette.border }]}><Avatar uri={entry.user.avatarUrl} label={entry.user.displayName} color={entry.user.avatarColor} size={46} /><View style={styles.contactCopy}><Text style={[styles.contactName, { color: palette.text }]}>{entry.user.displayName}</Text><Text style={[styles.contactUsername, { color: palette.secondaryText }]}>@{entry.user.username}</Text></View><AppIcon name="chevron-forward" size={18} color={palette.faintText} /></Pressable>)}
        </View> : null}
      </KeyboardAwareScrollView>
      {viewerIndex !== null && profile.photos[viewerIndex] ? <ProfileGalleryViewer photos={profile.photos} index={viewerIndex} onIndex={setViewerIndex} onClose={() => setViewerIndex(null)} /> : null}
      <ProfilePhotoActionsSheet
        visible={photoMenuVisible}
        busy={busy}
        selectedPhoto={selectedPhoto}
        primaryPhotoId={profile.photos[0]?.id ?? null}
        onClose={() => setPhotoMenuVisible(false)}
        onAdd={() => void addPhotos()}
        onMakePrimary={(photo) => {
          setPhotoMenuVisible(false);
          void makePrimary(photo);
        }}
        onDelete={(photo) => {
          setPhotoMenuVisible(false);
          confirmDelete(photo);
        }}
      />
      {busy && !editing ? <View style={[styles.busyOverlay, { backgroundColor: palette.overlay }]}><ActivityIndicator color="white" />{photoUploadProgress ? <Text style={styles.busyText}>{photoUploadProgress.completed}/{photoUploadProgress.total}</Text> : null}</View> : null}
    </View>
  );

}

function ProfileInput({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void; maxLength: number; multiline?: boolean }) {
  const palette = usePalette();
  return <View><Text style={[styles.inputLabel, { color: palette.secondaryText }]}>{label}</Text><TextInput {...props} placeholderTextColor={palette.faintText} style={[styles.input, props.multiline && styles.multiline, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]} /></View>;
}

function ProfilePhotoActionsSheet({ visible, busy, selectedPhoto, primaryPhotoId, onClose, onAdd, onMakePrimary, onDelete }: {
  visible: boolean;
  busy: boolean;
  selectedPhoto: ProfilePhoto | undefined;
  primaryPhotoId: string | null;
  onClose: () => void;
  onAdd: () => void;
  onMakePrimary: (photo: ProfilePhoto) => void;
  onDelete: (photo: ProfilePhoto) => void;
}) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <Modal transparent visible={visible} animationType="fade" navigationBarTranslucent={false} onRequestClose={busy ? undefined : onClose}>
      <Pressable disabled={busy} onPress={onClose} style={[styles.menuOverlay, { backgroundColor: palette.overlay }]}>
        <Pressable style={[styles.menuSheet, { backgroundColor: palette.elevated, borderColor: palette.border, paddingBottom: Math.max(insets.bottom + 12, 24) }]}>
          <View style={[styles.menuHandle, { backgroundColor: palette.faintText }]} />
          <Text style={[styles.menuTitle, { color: palette.text }]}>{t("profilePhotos")}</Text>
          <ProfilePhotoAction icon="images-outline" label={t("addPhoto")} onPress={onAdd} />
          {selectedPhoto && selectedPhoto.id !== primaryPhotoId ? <ProfilePhotoAction icon="checkmark" label={t("makeMainPhoto")} onPress={() => onMakePrimary(selectedPhoto)} /> : null}
          {selectedPhoto ? <ProfilePhotoAction icon="trash-outline" label={t("deletePhoto")} danger onPress={() => onDelete(selectedPhoto)} /> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ProfilePhotoAction({ icon, label, danger = false, onPress }: { icon: "images-outline" | "checkmark" | "trash-outline"; label: string; danger?: boolean; onPress: () => void }) {
  const palette = usePalette();
  const color = danger ? palette.danger : palette.text;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.menuAction, { backgroundColor: pressed ? palette.accentSoft : "transparent" }]}>
      <View style={[styles.menuIcon, { backgroundColor: palette.surface }]}><AppIcon name={icon} size={21} color={danger ? palette.danger : palette.accent} /></View>
      <Text style={[styles.menuActionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

function ProfileGalleryViewer({ photos, index, onIndex, onClose }: { photos: ProfilePhoto[]; index: number; onIndex: (index: number) => void; onClose: () => void }) {
  const items = useMemo<ImageGalleryItem[]>(() => photos.map((photo, photoIndex) => ({
    key: photo.id,
    uri: photo.url,
    filename: `snezhok-profile-${photoIndex + 1}.jpg`,
    mimeType: "image/jpeg",
  })), [photos]);
  return <ImageGalleryViewer visible items={items} initialIndex={index} onIndexChange={onIndex} onClose={onClose} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, loading: { flex: 1, alignItems: "center", justifyContent: "center" }, content: { paddingBottom: 34 },
  hero: { alignSelf: "center", height: 390, marginTop: 10, borderRadius: 30, borderWidth: 1, overflow: "hidden" }, heroPage: { height: 390 }, heroFallback: { flex: 1, alignItems: "center", justifyContent: "center" }, photoCounter: { position: "absolute", top: 14, right: 14, minWidth: 44, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: "rgba(12,14,20,0.66)", alignItems: "center", justifyContent: "center" }, photoCounterText: { color: "white", fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },
  identity: { alignItems: "center", paddingHorizontal: 22, paddingVertical: 18, marginHorizontal: 20, marginTop: -24, borderRadius: 24, zIndex: 2 }, name: { fontSize: 27, fontWeight: "800", letterSpacing: -0.7, textAlign: "center" }, username: { fontSize: 14, marginTop: 3 }, bio: { fontSize: 15, lineHeight: 21, textAlign: "center", marginTop: 12, maxWidth: 420 },
  form: { marginHorizontal: 20, marginTop: 18, padding: 16, gap: 12, borderRadius: 24 }, inputLabel: { fontSize: 12, fontWeight: "800", marginBottom: 6, marginLeft: 3 }, input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 }, multiline: { minHeight: 96, paddingTop: 12, textAlignVertical: "top" },
  primaryButton: { minHeight: 50, borderRadius: 12, marginHorizontal: 20, marginTop: 18, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" }, primaryButtonText: { fontSize: 15, fontWeight: "800" },
  section: { marginTop: 27, paddingHorizontal: 20 }, sectionTitle: { fontSize: 18, fontWeight: "800" },
  contact: { minHeight: 65, flexDirection: "row", alignItems: "center", borderRadius: 18, paddingHorizontal: 10, marginTop: 8 }, contactCopy: { flex: 1, marginLeft: 12 }, contactName: { fontSize: 16, fontWeight: "700" }, contactUsername: { fontSize: 13, marginTop: 2 },
  menuOverlay: { flex: 1, justifyContent: "flex-end" },
  menuSheet: { borderTopWidth: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 12, paddingTop: 9 },
  menuHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", opacity: 0.5 },
  menuTitle: { margin: 14, marginBottom: 6, fontSize: 21, fontWeight: "900", letterSpacing: -0.4 },
  menuAction: { height: 58, borderRadius: 16, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  menuIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  menuActionText: { fontSize: 16, fontWeight: "800" },
  busyOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 10 },
  busyText: { color: "white", fontSize: 14, fontWeight: "800", fontVariant: ["tabular-nums"] },
});
