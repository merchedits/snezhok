import { api } from "../../infrastructure/http/apiClient";
import { productApi, type GroupMember } from "../../infrastructure/http/productApiClient";
import type { UploadInput } from "../../types";
import { peopleUseCases } from "../people/peopleUseCases";

export type { GroupMember } from "../../infrastructure/http/productApiClient";

export const groupUseCases = {
  members: (conversationId: string) => productApi.groupMembers(conversationId),
  update: (conversationId: string, patch: { title?: string; avatarAttachmentId?: string | null }) => productApi.updateGroup(conversationId, patch),
  updatePhoto: async (conversationId: string, input: UploadInput) => {
    const attachment = await api.upload(input);
    return productApi.updateGroup(conversationId, { avatarAttachmentId: attachment.id });
  },
  addMember: (conversationId: string, userId: string) => productApi.addGroupMember(conversationId, userId),
  setMemberRole: (conversationId: string, member: GroupMember, role: "admin" | "member") => productApi.setGroupMemberRole(conversationId, member.user.id, role),
  removeMember: (conversationId: string, member: GroupMember) => productApi.removeGroupMember(conversationId, member.user.id),
  transferOwnership: (conversationId: string, userId: string) => productApi.transferGroup(conversationId, userId),
  leave: (conversationId: string) => productApi.leaveGroup(conversationId),
  searchUsers: peopleUseCases.search,
};
