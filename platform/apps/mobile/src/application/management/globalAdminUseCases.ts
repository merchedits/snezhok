import type { AdminMember, AdminSettings, GlobalPermission, GlobalPermissions } from "@snezhok/contracts";

import { ApiError, api } from "../../infrastructure/http/apiClient";

export type { AdminMember, AdminSettings, GlobalPermission, GlobalPermissions } from "@snezhok/contracts";
export { ApiError };

export const globalAdminUseCases = {
  load: async () => {
    const [settings, members] = await Promise.all([api.adminSettings(), api.adminMembers()]);
    return { settings, members };
  },
  settings: () => api.adminSettings(),
  updateSettings: (input: { revision: number } & Partial<Omit<AdminSettings, "revision" | "updatedAt">>) => api.updateAdminSettings(input),
  members: (query = "", cursor?: string) => api.adminMembers(query.trim(), cursor),
  updateMember: (userId: string, input: { isAdmin?: boolean; suspended?: boolean; permissionOverrides?: Partial<Record<GlobalPermission, boolean | null>>; storageQuotaBytes?: number | null }) => api.updateAdminMember(userId, input),
};
