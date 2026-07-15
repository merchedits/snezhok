package xyz.merchedits.snezhok.core;

import org.json.JSONException;
import org.json.JSONObject;

/** Immutable credentials and the minimum current-user projection. */
public final class AuthSession {
    private final String accessToken;
    private final String refreshToken;
    private final long expiresAtEpochMs;
    private final String userId;
    private final String username;
    private final String displayName;

    public AuthSession(
            String accessToken,
            String refreshToken,
            long expiresAtEpochMs,
            String userId,
            String username,
            String displayName) {
        this.accessToken = require(accessToken, "accessToken");
        this.refreshToken = require(refreshToken, "refreshToken");
        this.expiresAtEpochMs = expiresAtEpochMs;
        this.userId = require(userId, "userId");
        this.username = require(username, "username");
        this.displayName = displayName == null ? username : displayName;
    }

    public String getAccessToken() { return accessToken; }
    public String getRefreshToken() { return refreshToken; }
    public long getExpiresAtEpochMs() { return expiresAtEpochMs; }
    public String getUserId() { return userId; }
    public String getUsername() { return username; }
    public String getDisplayName() { return displayName; }

    public boolean needsRefresh(long nowEpochMs, long earlyRefreshMs) {
        return expiresAtEpochMs <= nowEpochMs + earlyRefreshMs;
    }

    JSONObject toJson() throws JSONException {
        return new JSONObject()
                .put("accessToken", accessToken)
                .put("refreshToken", refreshToken)
                .put("expiresAtEpochMs", expiresAtEpochMs)
                .put("userId", userId)
                .put("username", username)
                .put("displayName", displayName);
    }

    static AuthSession fromStoredJson(JSONObject json) throws JSONException {
        return new AuthSession(
                json.getString("accessToken"),
                json.getString("refreshToken"),
                json.getLong("expiresAtEpochMs"),
                json.getString("userId"),
                json.getString("username"),
                json.optString("displayName", json.getString("username")));
    }

    static AuthSession fromApiJson(JSONObject json, long nowEpochMs) throws JSONException {
        JSONObject user = json.getJSONObject("user");
        long expiresInSeconds = json.getLong("expiresIn");
        return new AuthSession(
                json.getString("accessToken"),
                json.getString("refreshToken"),
                nowEpochMs + Math.max(0L, expiresInSeconds) * 1000L,
                user.getString("id"),
                user.getString("username"),
                user.optString("displayName", user.getString("username")));
    }

    private static String require(String value, String field) {
        if (value == null || value.isEmpty()) {
            throw new IllegalArgumentException(field + " must not be empty");
        }
        return value;
    }
}
