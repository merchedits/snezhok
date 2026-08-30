import { api } from "../../infrastructure/http/apiClient";

export const linkPreviewUseCases = { load: (url: string) => api.linkPreview(url) };
