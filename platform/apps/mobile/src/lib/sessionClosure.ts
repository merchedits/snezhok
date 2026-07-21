type BoundedFetch = (url: string, init: RequestInit) => Promise<Response>;

export async function closeRemoteDeviceSession(
  apiUrl: string,
  accessToken: string,
  installationId: string | null | undefined,
  fetcher: BoundedFetch,
): Promise<void> {
  const headers = { Accept: "application/json", Authorization: `Bearer ${accessToken}` };
  let firstError: unknown = null;
  if (installationId) {
    try {
      const response = await fetcher(`${apiUrl}/notifications/devices/${encodeURIComponent(installationId)}`, { method: "DELETE", headers });
      if (!response.ok && response.status !== 401) throw new Error(`Push cleanup failed (${response.status})`);
    } catch (error) {
      firstError = error;
    }
  }
  try {
    const response = await fetcher(`${apiUrl}/auth/logout`, { method: "POST", headers });
    if (!response.ok && response.status !== 401) throw new Error(`Logout failed (${response.status})`);
  } catch (error) {
    firstError ??= error;
  }
  if (firstError) throw firstError;
}
