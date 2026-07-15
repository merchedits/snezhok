package xyz.merchedits.snezhok.core;

/** A structured error returned by the Snezhok API or its transport. */
public final class ApiException extends Exception {
    private final int statusCode;
    private final String code;
    private final String details;

    public ApiException(int statusCode, String code, String message, String details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }

    public int getStatusCode() {
        return statusCode;
    }

    public String getCode() {
        return code;
    }

    public String getDetails() {
        return details;
    }
}
