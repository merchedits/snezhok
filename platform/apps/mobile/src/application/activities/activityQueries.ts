import { api } from "../../infrastructure/http/apiClient";

export const activityQueries = {
  detail: (activityId: string) => api.activity(activityId),
  history: (conversationId: string) => api.activityHistory(conversationId),
};
