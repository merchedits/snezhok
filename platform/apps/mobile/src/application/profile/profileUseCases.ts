import type { ConversationSummary, ProfilePhoto, UserProfile } from "@snezhok/contracts";

import { api } from "../../infrastructure/http/apiClient";
import type { UploadInput } from "../../types";

export interface ProfileGateway {
  profile(userId: string): Promise<UserProfile>;
  updateProfile(input: { displayName?: string; bio?: string; statusText?: string }): ReturnType<typeof api.updateProfile>;
  upload(input: UploadInput): ReturnType<typeof api.upload>;
  addProfilePhoto(attachmentId: string): Promise<UserProfile>;
  reorderProfilePhotos(attachmentIds: string[]): Promise<UserProfile>;
  removeProfilePhoto(attachmentId: string): Promise<UserProfile>;
}

export function createProfileUseCases(gateway: ProfileGateway) {
  return {
    load: (userId: string) => gateway.profile(userId),
    update: (input: { displayName: string; bio: string; statusText: string }) => gateway.updateProfile({
      displayName: input.displayName.trim(), bio: input.bio.trim(), statusText: input.statusText.trim(),
    }),
    addPhoto: async (input: UploadInput) => gateway.addProfilePhoto((await gateway.upload(input)).id),
    makePrimary: (profile: UserProfile, photo: ProfilePhoto) => gateway.reorderProfilePhotos([
      photo.id, ...profile.photos.filter((item) => item.id !== photo.id).map((item) => item.id),
    ]),
    removePhoto: (photoId: string) => gateway.removeProfilePhoto(photoId),
  };
}

export const profileUseCases = createProfileUseCases({
  profile: (userId) => api.profile(userId),
  updateProfile: (input) => api.updateProfile(input),
  upload: (input) => api.upload(input),
  addProfilePhoto: (attachmentId) => api.addProfilePhoto(attachmentId),
  reorderProfilePhotos: (attachmentIds) => api.reorderProfilePhotos(attachmentIds),
  removeProfilePhoto: (attachmentId) => api.removeProfilePhoto(attachmentId),
});

export function directConversation(conversations: readonly ConversationSummary[], userId: string) {
  return conversations.find((conversation) => conversation.kind === "direct" && conversation.participants.some((participant) => participant.id === userId));
}
