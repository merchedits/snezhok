import { api } from "../../infrastructure/http/apiClient";

export type SearchScope = "all" | "messages" | "media" | "files" | "links";

export const searchUseCases = {
  search: (query: string, streamId: string | undefined, scope: SearchScope) => api.search(query.trim(), streamId, scope),
};
