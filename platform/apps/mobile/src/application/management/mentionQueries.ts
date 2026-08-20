import { productApi } from "../../infrastructure/http/productApiClient";

export const mentionQueries = {
  page: (before?: string) => productApi.mentions(before),
};
