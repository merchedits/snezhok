import type { PrivacySettings } from "@snezhok/contracts";

import { peopleUseCases } from "../people/peopleUseCases";
import { productApi } from "../../infrastructure/http/productApiClient";

export const accountUseCases = {
  load: async () => {
    const [sessions, privacy] = await Promise.all([productApi.sessions(), productApi.privacy()]);
    return { sessions, privacy };
  },
  updatePrivacy: (patch: Partial<PrivacySettings>) => productApi.updatePrivacy(patch),
  revokeSession: (sessionId: string) => productApi.revokeSession(sessionId),
  revokeOtherSessions: () => productApi.revokeOtherSessions(),
  deleteAccount: (password: string) => productApi.deleteAccount(password),
  searchUsers: peopleUseCases.search,
  blockUser: peopleUseCases.blockUser,
  unblockUser: peopleUseCases.unblockUser,
};
