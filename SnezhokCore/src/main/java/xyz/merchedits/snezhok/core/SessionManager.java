package xyz.merchedits.snezhok.core;

import org.json.JSONObject;

/**
 * Coordinates durable login and refresh-token rotation. All refreshes pass
 * through one monitor, preventing concurrent 401 handlers from invalidating one
 * another's rotated refresh tokens.
 */
public final class SessionManager {
    private static final long EARLY_REFRESH_MS = 30_000L;

    private final SnezhokApiClient api;
    private final SessionStore store;
    private AuthSession session;

    public SessionManager(SnezhokApiClient api, SessionStore store) {
        this.api = api;
        this.store = store;
        this.session = store.read();
    }

    public synchronized AuthSession current() {
        return session;
    }

    public synchronized AuthSession login(String username, String password, String deviceName)
            throws ApiException {
        return replace(api.login(username, password, deviceName));
    }

    public synchronized AuthSession register(
            String email, String username, String password, String deviceName)
            throws ApiException {
        return replace(api.register(email, username, password, deviceName));
    }

    public synchronized String validAccessToken() throws ApiException {
        if (session == null) {
            throw new ApiException(401, "NOT_AUTHENTICATED", "Sign in to continue", null);
        }
        if (session.needsRefresh(System.currentTimeMillis(), EARLY_REFRESH_MS)) {
            replace(api.refresh(session.getRefreshToken()));
        }
        return session.getAccessToken();
    }

    public synchronized JSONObject bootstrap() throws ApiException {
        return api.bootstrap(validAccessToken());
    }

    public synchronized void logoutLocal() {
        session = null;
        store.clear();
    }

    private AuthSession replace(AuthSession replacement) {
        store.write(replacement);
        session = replacement;
        return replacement;
    }
}
