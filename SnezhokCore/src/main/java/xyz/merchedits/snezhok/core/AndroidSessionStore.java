package xyz.merchedits.snezhok.core;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Update-stable session persistence. Android 23+ credentials are encrypted with
 * an app-scoped Keystore key. Android 21-22 use private app storage as a
 * compatibility fallback and are migrated to encrypted storage on upgrade.
 */
public final class AndroidSessionStore implements SessionStore {
    private static final String STORE = "snezhok.session.v1";
    private static final String VALUE = "session";
    private static final String MODE = "mode";
    private static final String MODE_ENCRYPTED = "gcm";
    private static final String MODE_PRIVATE = "private";
    private static final String KEY_ALIAS = "snezhok.session.key.v1";

    private final SharedPreferences preferences;

    public AndroidSessionStore(Context context) {
        preferences = context.getApplicationContext()
                .getSharedPreferences(STORE, Context.MODE_PRIVATE);
    }

    @Override
    public synchronized AuthSession read() {
        String encoded = preferences.getString(VALUE, null);
        if (encoded == null) {
            return null;
        }
        try {
            String mode = preferences.getString(MODE, MODE_PRIVATE);
            byte[] bytes = MODE_ENCRYPTED.equals(mode)
                    ? decrypt(Base64.decode(encoded, Base64.NO_WRAP))
                    : Base64.decode(encoded, Base64.NO_WRAP);
            AuthSession session = AuthSession.fromStoredJson(
                    new JSONObject(new String(bytes, StandardCharsets.UTF_8)));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !MODE_ENCRYPTED.equals(mode)) {
                write(session);
            }
            return session;
        } catch (Exception invalidOrUnrecoverable) {
            clear();
            return null;
        }
    }

    @Override
    public synchronized void write(AuthSession session) {
        try {
            byte[] clear = session.toJson().toString().getBytes(StandardCharsets.UTF_8);
            boolean encrypt = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M;
            byte[] stored = encrypt ? encrypt(clear) : clear;
            preferences.edit()
                    .putString(VALUE, Base64.encodeToString(stored, Base64.NO_WRAP))
                    .putString(MODE, encrypt ? MODE_ENCRYPTED : MODE_PRIVATE)
                    .commit();
        } catch (Exception failure) {
            throw new IllegalStateException("Unable to persist the Snezhok session", failure);
        }
    }

    @Override
    public synchronized void clear() {
        preferences.edit().clear().commit();
    }

    private static byte[] encrypt(byte[] clear) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] encrypted = cipher.doFinal(clear);
        byte[] iv = cipher.getIV();
        byte[] result = new byte[1 + iv.length + encrypted.length];
        result[0] = (byte) iv.length;
        System.arraycopy(iv, 0, result, 1, iv.length);
        System.arraycopy(encrypted, 0, result, 1 + iv.length, encrypted.length);
        return result;
    }

    private static byte[] decrypt(byte[] stored) throws Exception {
        int ivLength = stored[0] & 0xff;
        if (ivLength < 12 || stored.length <= 1 + ivLength) {
            throw new IllegalArgumentException("Invalid encrypted session");
        }
        byte[] iv = new byte[ivLength];
        byte[] encrypted = new byte[stored.length - 1 - ivLength];
        System.arraycopy(stored, 1, iv, 0, ivLength);
        System.arraycopy(stored, 1 + ivLength, encrypted, 0, encrypted.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, iv));
        return cipher.doFinal(encrypted);
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(
                KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }
}
