package xyz.merchedits.snezhok.core;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/** Minimal native REST client for the first authentication/bootstrap slice. */
public final class SnezhokApiClient {
    public static final String PRODUCTION_API = "https://merchedits.xyz/chat/api/v1";

    private final String baseUrl;
    private final HttpTransport transport;

    public SnezhokApiClient() {
        this(PRODUCTION_API, new UrlConnectionTransport());
    }

    SnezhokApiClient(String baseUrl, HttpTransport transport) {
        if (baseUrl == null || !baseUrl.startsWith("https://")) {
            throw new IllegalArgumentException("Snezhok API must use HTTPS");
        }
        this.baseUrl = baseUrl.endsWith("/")
                ? baseUrl.substring(0, baseUrl.length() - 1)
                : baseUrl;
        this.transport = transport;
    }

    public AuthSession login(String username, String password, String deviceName)
            throws ApiException {
        JSONObject input = new JSONObject();
        try {
            input.put("username", username);
            input.put("password", password);
            input.put("deviceName", deviceName);
            input.put("platform", "android");
            return AuthSession.fromApiJson(post("/auth/login", input, null),
                    System.currentTimeMillis());
        } catch (JSONException malformedResponse) {
            throw invalidResponse(malformedResponse);
        }
    }

    public AuthSession register(
            String email,
            String username,
            String password,
            String deviceName) throws ApiException {
        JSONObject input = new JSONObject();
        try {
            input.put("email", email);
            input.put("username", username);
            input.put("password", password);
            input.put("deviceName", deviceName);
            input.put("platform", "android");
            return AuthSession.fromApiJson(post("/auth/register", input, null),
                    System.currentTimeMillis());
        } catch (JSONException malformedResponse) {
            throw invalidResponse(malformedResponse);
        }
    }

    public AuthSession refresh(String refreshToken) throws ApiException {
        JSONObject input = new JSONObject();
        try {
            input.put("refreshToken", refreshToken);
            return AuthSession.fromApiJson(post("/auth/refresh", input, null),
                    System.currentTimeMillis());
        } catch (JSONException malformedResponse) {
            throw invalidResponse(malformedResponse);
        }
    }

    public JSONObject bootstrap(String accessToken) throws ApiException {
        return request("GET", "/bootstrap", null, accessToken);
    }

    private JSONObject post(String path, JSONObject body, String accessToken)
            throws ApiException {
        return request("POST", path, body, accessToken);
    }

    private JSONObject request(String method, String path, JSONObject body, String accessToken)
            throws ApiException {
        Map<String, String> headers = new HashMap<>();
        headers.put("Accept", "application/json");
        if (body != null) {
            headers.put("Content-Type", "application/json; charset=utf-8");
        }
        if (accessToken != null) {
            headers.put("Authorization", "Bearer " + accessToken);
        }
        byte[] bytes = body == null ? null : body.toString().getBytes(StandardCharsets.UTF_8);
        final HttpTransport.Response response;
        try {
            response = transport.execute(method, baseUrl + path,
                    Collections.unmodifiableMap(headers), bytes);
        } catch (IOException networkFailure) {
            throw new ApiException(0, "NETWORK_ERROR", "Unable to reach Snezhok",
                    networkFailure.getMessage());
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
            throw parseApiError(response);
        }
        try {
            return response.body.isEmpty() ? new JSONObject() : new JSONObject(response.body);
        } catch (JSONException malformedResponse) {
            throw invalidResponse(malformedResponse);
        }
    }

    private static ApiException parseApiError(HttpTransport.Response response) {
        try {
            JSONObject error = new JSONObject(response.body);
            return new ApiException(
                    response.statusCode,
                    error.optString("code", "HTTP_" + response.statusCode),
                    error.optString("message", "Snezhok request failed"),
                    error.has("details") ? String.valueOf(error.opt("details")) : null);
        } catch (JSONException ignored) {
            return new ApiException(response.statusCode, "HTTP_" + response.statusCode,
                    "Snezhok request failed", null);
        }
    }

    private static ApiException invalidResponse(Exception cause) {
        return new ApiException(0, "INVALID_RESPONSE", "Snezhok returned invalid data",
                cause.getMessage());
    }
}
