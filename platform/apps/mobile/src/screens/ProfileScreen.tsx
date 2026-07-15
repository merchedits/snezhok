import { AppIcon } from "../components/AppIcon";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ProfilePhoto, UserProfile } from "@snezhok/contracts";

import { Avatar } from "../components/Avatar";
import { ScreenHeader } from "../components/ScreenHeader";
import { useAuthorizedMedia } from "../hooks/useAuthorizedMedia";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { api } from "../lib/api";
import { useAppStore } from "../store/useAppStore";
import type { RootStackParamList } from "../types";

interface ProfileScreenProps { embedded?: boolean; active?: boolean; userId?: string; onBack?: () => void }

export function PublicProfileScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, "Profile">) {
  return <ProfileScreen userId={route.params.userId} onBack={navigation.goBack} />;
}

export function ProfileScreen({ embedded = false, active = true, userId, onBack }: ProfileScreenProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
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
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(me?.displayName ?? "");
  const [bio, setBio] = useState(me?.bio ?? "");
  const [statusText, setStatusText] = useState(me?.statusText ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active || !targetId) return;
    let mounted = true;
    const timer = setTimeout(() => {
      void api.profile(targetId).then((next) => {
        if (!mounted) return;
        setProfile(next);
        setDisplayName(next.user.displayName);
        setBio(next.user.bio);
        setStatusText(next.user.statusText);
        setSelectedPhotoId(null);
      }).catch((error) => {
        if (mounted && !profile) Alert.alert(t("profileLoadFailed"), error instanceof Error ? error.message : t("tryAgain"));
      });
    }, embedded ? 220 : 0);
    return () => { mounted = false; clearTimeout(timer); };
  }, [active, embedded, targetId]);

  const selectedPhoto = profile?.photos.find((photo) => photo.id === selectedPhotoId) ?? profile?.photos[0];
  const contactEntries = useMemo(() => own ? friends.filter((entry) => entry.relationship === "friend") : [], [friends, own]);

  const saveProfile = async () => {
    if (!displayName.trim() || busy) return;
    setBusy(true);
    try {
      const user = await api.updateProfile({ displayName: displayName.trim(), bio: bio.trim(), statusText: statusText.trim() });
      setProfile((current) => current ? { ...current, user } : { user, photos: [] });
      await refreshBootstrap();
      setEditing(false);
    } catch (error) {
      Alert.alert(t("profileSaveFailed"), error instanceof Error ? error.message : t("tryAgain"));
    } finally { setBusy(false); }
  };

  const addPhoto = async () => {
    if (busy) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert(t("permissionPhotos"), t("allowPhotos"));
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, allowsEditing: true, aspect: [1, 1] });
    const asset = result.assets?.[0];
    if (!asset) return;
    setBusy(true);
    try {
      const attachment = await api.upload({ uri: asset.uri, filename: asset.fileName ?? `profile-${Date.now()}.jpg`, mimeType: asset.mimeType ?? "image/jpeg", kind: "image", quality: "high" });
      const next = await api.addProfilePhoto(attachment.id);
      setProfile(next); setSelectedPhotoId(null);
      await refreshBootstrap();
    } catch (error) {
      Alert.alert(t("uploadFailed"), error instanceof Error ? error.message : t("tryAgain"));
    } finally { setBusy(false); }
  };

  const makePrimary = async (photo: ProfilePhoto) => {
    if (!own || !profile || profile.photos[0]?.id === photo.id || busy) return;
    setBusy(true);
    try {
      const next = await api.reorderProfilePhotos([photo.id, ...profile.photos.filter((item) => item.id !== photo.id).map((item) => item.id)]);
      setProfile(next); setSelectedPhotoId(null);
      await refreshBootstrap();
    } catch (error) { Alert.alert(t("profileSaveFailed"), error instanceof Error ? error.message : t("tryAgain")); }
    finally { setBusy(false); }
  };

  const confirmDelete = (photo: ProfilePhoto) => Alert.alert(t("deletePhoto"), t("deletePhotoConfirm"), [
    { text: t("cancel"), style: "cancel" },
    { text: t("deletePhoto"), style: "destructive", onPress: () => void removePhoto(photo.id) },
  ]);

  const removePhoto = async (photoId: string) => {
    setBusy(true);
    try {
      const next = await api.removeProfilePhoto(photoId);
      setProfile(next); setSelectedPhotoId(null);
      await refreshBootstrap();
    } catch (error) { Alert.alert(t("profileSaveFailed"), error instanceof Error ? error.message : t("tryAgain")); }
    finally { setBusy(false); }
  };

  const openChat = async () => {
    if (!profile) return;
    const direct = conversations.find((conversation) => conversation.kind === "direct" && conversation.participants.some((user) => user.id === profile.user.id));
    try {
      const conversation = direct ?? await api.createConversation([profile.user.id]);
      if (!direct) applyConversation(conversation);
      navigation.navigate("Chat", { streamId: conversation.id, streamKind: "conversation", title: conversation.title });
    } catch (error) { Alert.alert(t("openChatFailed"), error instanceof Error ? error.message : t("tryAgain")); }
  };

  const openContact = (contactId: string) => navigation.navigate("Profile", { userId: contactId });

  if (!profile) return <View style={[styles.loading, { backgroundColor: palette.background }]}><ActivityIndicator color={palette.accent} /></View>;
  const user = profile.user;
  const heroUri = selectedPhoto?.url ?? user.avatarUrl;

  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <ScreenHeader title={t("profile")} {...(!embedded && onBack ? { left: { icon: "chevron-back" as const, label: t("back"), onPress: onBack } } : {})} right={own ? [{ icon: editing ? "checkmark" : "create-outline", label: editing ? t("save") : t("editProfile"), onPress: editing ? () => void saveProfile() : () => setEditing(true) }] : []} />
      <ScrollView contentContainerStyle={[styles.content, !embedded && { paddingBottom: Math.max(insets.bottom + 16, 34) }]} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Avatar uri={heroUri} label={user.displayName} color={user.avatarColor} online={user.presence === "online"} size={112} />
          {own ? <Pressable disabled={busy} onPress={() => void addPhoto()} style={[styles.camera, { backgroundColor: palette.accent, borderColor: palette.background }]}><AppIcon name="camera" size={19} color="white" /></Pressable> : null}
        </View>
        {editing ? <View style={styles.form}>
          <ProfileInput label={t("displayName")} value={displayName} onChangeText={setDisplayName} maxLength={48} />
          <ProfileInput label={t("status")} value={statusText} onChangeText={setStatusText} maxLength={128} />
          <ProfileInput label={t("bio")} value={bio} onChangeText={setBio} maxLength={512} multiline />
          <Pressable disabled={busy || !displayName.trim()} onPress={() => void saveProfile()} style={[styles.primaryButton, { backgroundColor: palette.accent, opacity: busy || !displayName.trim() ? 0.55 : 1 }]}>{busy ? <ActivityIndicator color="white" /> : <Text style={styles.primaryButtonText}>{t("save")}</Text>}</Pressable>
        </View> : <View style={styles.identity}>
          <Text style={[styles.name, { color: palette.text }]}>{user.displayName}</Text>
          <Text style={[styles.username, { color: palette.secondaryText }]}>@{user.username}</Text>
          {user.statusText ? <Text style={[styles.status, { color: palette.accent }]}>{user.statusText}</Text> : null}
          {user.bio ? <Text style={[styles.bio, { color: palette.text }]}>{user.bio}</Text> : null}
        </View>}
        {!own ? <Pressable onPress={() => void openChat()} style={[styles.primaryButton, { backgroundColor: palette.accent }]}><AppIcon name="chatbubble-outline" size={18} color="white" /><Text style={styles.primaryButtonText}>{t("messageUser")}</Text></Pressable> : null}

        {(own || profile.photos.length > 0) ? <View style={styles.section}>
          <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: palette.text }]}>{t("profilePhotos")}</Text>{own ? <Pressable disabled={busy} onPress={() => void addPhoto()}><Text style={[styles.sectionAction, { color: palette.accent }]}>{t("addPhoto")}</Text></Pressable> : null}</View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
            {profile.photos.map((photo, index) => <PhotoThumbnail key={photo.id} photo={photo} selected={(selectedPhoto?.id ?? profile.photos[0]?.id) === photo.id} primary={index === 0} onPress={() => setSelectedPhotoId(photo.id)} {...(own ? { onLongPress: () => confirmDelete(photo) } : {})} />)}
          </ScrollView>
          {own && selectedPhoto ? <View style={styles.photoActions}>{profile.photos[0]?.id !== selectedPhoto.id ? <Pressable disabled={busy} onPress={() => void makePrimary(selectedPhoto)} style={[styles.photoAction, { backgroundColor: palette.accentSoft }]}><Text style={[styles.photoActionText, { color: palette.accent }]}>{t("makeMainPhoto")}</Text></Pressable> : null}<Pressable disabled={busy} onPress={() => confirmDelete(selectedPhoto)} style={[styles.photoAction, { backgroundColor: palette.surface }]}><Text style={[styles.photoActionText, { color: palette.danger }]}>{t("deletePhoto")}</Text></Pressable></View> : null}
        </View> : null}

        {own && contactEntries.length > 0 ? <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: palette.text }]}>{t("contacts")}</Text>
          {contactEntries.map((entry) => <Pressable key={entry.user.id} onPress={() => openContact(entry.user.id)} style={[styles.contact, { borderColor: palette.border }]}><Avatar uri={entry.user.avatarUrl} label={entry.user.displayName} color={entry.user.avatarColor} size={46} /><View style={styles.contactCopy}><Text style={[styles.contactName, { color: palette.text }]}>{entry.user.displayName}</Text><Text style={[styles.contactUsername, { color: palette.secondaryText }]}>@{entry.user.username}</Text></View><AppIcon name="chevron-forward" size={18} color={palette.faintText} /></Pressable>)}
        </View> : null}
      </ScrollView>
      {busy && !editing ? <View style={[styles.busyOverlay, { backgroundColor: palette.overlay }]}><ActivityIndicator color="white" /></View> : null}
    </View>
  );

}

function ProfileInput({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void; maxLength: number; multiline?: boolean }) {
  const palette = usePalette();
  return <View><Text style={[styles.inputLabel, { color: palette.secondaryText }]}>{label}</Text><TextInput {...props} placeholderTextColor={palette.faintText} style={[styles.input, props.multiline && styles.multiline, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]} /></View>;
}

function PhotoThumbnail({ photo, selected, primary, onPress, onLongPress }: { photo: ProfilePhoto; selected: boolean; primary: boolean; onPress: () => void; onLongPress?: () => void }) {
  const palette = usePalette();
  const source = useAuthorizedMedia(photo.thumbnailUrl ?? photo.url);
  return <Pressable onPress={onPress} onLongPress={onLongPress} style={[styles.thumbnailFrame, { borderColor: selected ? palette.accent : "transparent" }]}><Image source={source} cachePolicy="memory-disk" contentFit="cover" recyclingKey={photo.id} style={styles.thumbnail} />{primary ? <View style={[styles.primaryBadge, { backgroundColor: palette.accent }]}><AppIcon name="checkmark" size={11} color="white" strokeWidth={2} /></View> : null}</Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, loading: { flex: 1, alignItems: "center", justifyContent: "center" }, content: { paddingBottom: 34 },
  hero: { alignSelf: "center", marginTop: 20 }, camera: { position: "absolute", right: -2, bottom: 2, width: 36, height: 36, borderRadius: 18, borderWidth: 3, alignItems: "center", justifyContent: "center" },
  identity: { alignItems: "center", paddingHorizontal: 24, marginTop: 14 }, name: { fontSize: 25, fontWeight: "800", textAlign: "center" }, username: { fontSize: 14, marginTop: 3 }, status: { fontSize: 14, fontWeight: "600", marginTop: 9 }, bio: { fontSize: 15, lineHeight: 21, textAlign: "center", marginTop: 12, maxWidth: 420 },
  form: { marginTop: 18, paddingHorizontal: 16, gap: 12 }, inputLabel: { fontSize: 12, fontWeight: "700", marginBottom: 6, marginLeft: 3 }, input: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingHorizontal: 14, fontSize: 16 }, multiline: { minHeight: 96, paddingTop: 12, textAlignVertical: "top" },
  primaryButton: { minHeight: 48, borderRadius: 13, marginHorizontal: 16, marginTop: 18, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center" }, primaryButtonText: { color: "white", fontSize: 15, fontWeight: "800" },
  section: { marginTop: 27, paddingHorizontal: 16 }, sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, sectionTitle: { fontSize: 17, fontWeight: "800" }, sectionAction: { fontSize: 14, fontWeight: "700" }, photoStrip: { gap: 10, paddingTop: 12, paddingBottom: 3 }, thumbnailFrame: { width: 70, height: 70, borderRadius: 37, borderWidth: 2, padding: 2 }, thumbnail: { width: 62, height: 62, borderRadius: 31 }, primaryBadge: { position: "absolute", right: -1, bottom: -1, width: 19, height: 19, borderRadius: 10, alignItems: "center", justifyContent: "center" }, photoActions: { flexDirection: "row", gap: 8, marginTop: 10 }, photoAction: { minHeight: 36, borderRadius: 10, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" }, photoActionText: { fontSize: 13, fontWeight: "700" },
  contact: { minHeight: 65, flexDirection: "row", alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth }, contactCopy: { flex: 1, marginLeft: 12 }, contactName: { fontSize: 16, fontWeight: "600" }, contactUsername: { fontSize: 13, marginTop: 2 }, busyOverlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
});
