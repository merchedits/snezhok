package org.telegram.messenger;

import xyz.merchedits.snezhok.preview.BuildConfig;
import xyz.merchedits.snezhok.preview.SnezhokRuntime;

/**
 * Preview-only application loader. Keeping this class in Telegram's package is
 * required by the retained application lifecycle while the Snezhok shell is
 * being introduced incrementally.
 */
public final class ApplicationLoaderImpl extends ApplicationLoader {
    @Override
    public void onCreate() {
        super.onCreate();
        SnezhokRuntime.initialize(this);
    }

    @Override
    protected String onGetApplicationId() {
        return BuildConfig.APPLICATION_ID;
    }
}
