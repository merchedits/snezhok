package xyz.merchedits.snezhok.core;

import java.io.IOException;
import java.util.Map;

interface HttpTransport {
    Response execute(String method, String url, Map<String, String> headers, byte[] body)
            throws IOException;

    final class Response {
        final int statusCode;
        final String body;

        Response(int statusCode, String body) {
            this.statusCode = statusCode;
            this.body = body == null ? "" : body;
        }
    }
}
