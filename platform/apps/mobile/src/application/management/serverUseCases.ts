import type {
  ChannelPermissionOverride,
  MemberRole,
  ServerPermission,
  ServerRoleDefinition,
} from "@snezhok/contracts";

import type { UploadInput } from "../../types";
import { api } from "../../infrastructure/http/apiClient";
import {
  productApi,
} from "../../infrastructure/http/productApiClient";
import { peopleUseCases } from "../people/peopleUseCases";

export type { ServerBan, ServerDetails, ServerMemberView } from "../../infrastructure/http/productApiClient";

export const serverUseCases = {
  create: (name: string) => api.createServer(name.trim()),
  loadManagement: async (serverId: string) => {
    const [details, members, roles] = await Promise.all([
      productApi.server(serverId),
      productApi.serverMembers(serverId),
      productApi.serverRoles(serverId),
    ]);
    return { details, members, roles };
  },
  bans: (serverId: string) => productApi.serverBans(serverId),
  audit: (serverId: string, before?: string) => productApi.auditLog(serverId, before),
  update: (serverId: string, patch: { name?: string; iconAttachmentId?: string | null }) => productApi.updateServer(serverId, patch),
  updateIcon: async (serverId: string, input: UploadInput) => {
    const attachment = await api.upload(input);
    return productApi.updateServer(serverId, { iconAttachmentId: attachment.id });
  },
  remove: (serverId: string) => productApi.deleteServer(serverId),
  transfer: (serverId: string, userId: string) => productApi.transferServer(serverId, userId),
  leave: (serverId: string, userId: string) => productApi.leaveServer(serverId, userId),
  addMember: (serverId: string, userId: string) => productApi.addServerMember(serverId, userId),
  addMemberByUsername: async (serverId: string, usernameInput: string) => {
    const username = usernameInput.trim().replace(/^@/, "").toLowerCase();
    const users = await peopleUseCases.search(username);
    const user = users.find((candidate) => candidate.username.toLowerCase() === username);
    if (!user) return false;
    await productApi.addServerMember(serverId, user.id);
    return true;
  },
  updateMember: (serverId: string, userId: string, patch: { role?: Exclude<MemberRole, "owner">; roleIds?: string[] }) => productApi.updateServerMember(serverId, userId, patch),
  kickMember: (serverId: string, userId: string) => productApi.kickServerMember(serverId, userId),
  banMember: (serverId: string, userId: string) => productApi.banServerMember(serverId, userId),
  unbanMember: (serverId: string, userId: string) => productApi.unbanServerMember(serverId, userId),
  createRole: (serverId: string, name: string) => productApi.createServerRole(serverId, { name: name.trim(), color: null, permissions: [] }),
  updateRole: (serverId: string, roleId: string, patch: Partial<Pick<ServerRoleDefinition, "name" | "color" | "permissions" | "position">>) => productApi.updateServerRole(serverId, roleId, patch),
  removeRole: (serverId: string, roleId: string) => productApi.deleteServerRole(serverId, roleId),
  createCategory: (serverId: string, name: string) => productApi.createCategory(serverId, name.trim()),
  updateCategory: (serverId: string, categoryId: string, patch: { name?: string; position?: number }) => productApi.updateCategory(serverId, categoryId, patch),
  removeCategory: (serverId: string, categoryId: string) => productApi.deleteCategory(serverId, categoryId),
  createChannel: (serverId: string, input: { name: string; kind: "text" | "voice"; categoryId: string | null; topic: string }) => productApi.createChannel(serverId, input),
  updateChannel: (serverId: string, channelId: string, patch: { name?: string; topic?: string; categoryId?: string | null; position?: number }) => productApi.updateChannel(serverId, channelId, patch),
  removeChannel: (serverId: string, channelId: string) => productApi.deleteChannel(serverId, channelId),
  overrides: (serverId: string, channelId: string) => productApi.channelOverrides(serverId, channelId),
  setOverride: (serverId: string, channelId: string, targetType: ChannelPermissionOverride["targetType"], targetId: string, body: { allow: ServerPermission[]; deny: ServerPermission[] }) => productApi.setChannelOverride(serverId, channelId, targetType, targetId, body),
  removeOverride: (serverId: string, channelId: string, targetType: ChannelPermissionOverride["targetType"], targetId: string) => productApi.removeChannelOverride(serverId, channelId, targetType, targetId),
};
