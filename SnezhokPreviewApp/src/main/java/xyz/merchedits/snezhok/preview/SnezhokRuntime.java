package xyz.merchedits.snezhok.preview;

import android.content.Context;

import xyz.merchedits.snezhok.core.AndroidSessionStore;
import xyz.merchedits.snezhok.core.SessionManager;
import xyz.merchedits.snezhok.core.SnezhokApiClient;

/** Process-scoped entry point for Snezhok-native services during migration. */
public final class SnezhokRuntime {
    private static volatile SessionManager sessionManager;

    private SnezhokRuntime() {
    }

    public static void initialize(Context context) {
        if (sessionManager != null) {
            return;
        }
        synchronized (SnezhokRuntime.class) {
            if (sessionManager == null) {
                sessionManager = new SessionManager(
                        new SnezhokApiClient(),
                        new AndroidSessionStore(context));
            }
        }
    }

    public static SessionManager sessions() {
        SessionManager value = sessionManager;
        if (value == null) {
            throw new IllegalStateException("SnezhokRuntime has not been initialized");
        }
        return value;
    }
}
