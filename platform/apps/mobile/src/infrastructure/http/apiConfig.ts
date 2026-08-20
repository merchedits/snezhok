import Constants from "expo-constants";

const configuredUrl = Constants.expoConfig?.extra?.apiUrl as string | undefined;

export const API_URL = (configuredUrl ?? "https://merchedits.xyz/chat/api/v1").replace(/\/$/, "");
