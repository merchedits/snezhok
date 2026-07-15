package xyz.merchedits.snezhok.core;

public interface SessionStore {
    AuthSession read();
    void write(AuthSession session);
    void clear();
}
