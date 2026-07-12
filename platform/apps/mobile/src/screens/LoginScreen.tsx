import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useAppStore } from "../store/useAppStore";

export function LoginScreen() {
  const palette = usePalette();
  const signIn = useAppStore((state) => state.signIn);
  const signUp = useAppStore((state) => state.signUp);
  const error = useAppStore((state) => state.error);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = Boolean(username.trim() && password.length >= 8 && (!registering || (displayName.trim() && inviteCode.trim() && password === confirmPassword)));

  const submit = async () => {
    if (!username.trim() || password.length < 8 || busy || (registering && (!displayName.trim() || !inviteCode.trim() || password !== confirmPassword))) return;
    setBusy(true);
    if (registering) await signUp({ username: username.trim(), displayName: displayName.trim(), password, inviteCode: inviteCode.trim() }).catch(() => undefined);
    else await signIn(username, password).catch(() => undefined);
    setBusy(false);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.content}>
          <View style={[styles.mark, { backgroundColor: palette.accent }]}>
            <Text style={styles.markText}>S</Text>
          </View>
          <Text style={[styles.title, { color: palette.text }]}>Snezhok</Text>
          <Text style={[styles.caption, { color: palette.secondaryText }]}>{registering ? "Create an invite-only account." : "Private messages, files and calls."}</Text>
          <View style={styles.form}>
            {registering ? <TextInput autoCapitalize="words" autoComplete="name" placeholder="Display name" placeholderTextColor={palette.faintText} value={displayName} onChangeText={setDisplayName} style={[styles.input, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]} /> : null}
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              placeholder="Username"
              placeholderTextColor={palette.faintText}
              value={username}
              onChangeText={setUsername}
              style={[styles.input, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]}
            />
            {registering ? <><TextInput autoCapitalize="none" placeholder="Confirm password" placeholderTextColor={palette.faintText} secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} style={[styles.input, { color: palette.text, backgroundColor: palette.surface, borderColor: password !== confirmPassword && confirmPassword ? palette.danger : palette.border }]} /><TextInput autoCapitalize="characters" placeholder="Invite code" placeholderTextColor={palette.faintText} value={inviteCode} onChangeText={setInviteCode} onSubmitEditing={() => void submit()} style={[styles.input, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]} /></> : null}
            <TextInput
              autoCapitalize="none"
              autoComplete="current-password"
              placeholder="Password"
              placeholderTextColor={palette.faintText}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={() => void submit()}
              style={[styles.input, { color: palette.text, backgroundColor: palette.surface, borderColor: palette.border }]}
            />
            {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => void submit()}
              disabled={busy || !valid}
              style={({ pressed }) => [styles.submit, { backgroundColor: palette.accent, opacity: pressed || busy || !valid ? 0.7 : 1 }]}
            >
              {busy ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>{registering ? "Create account" : "Sign in"}</Text>}
            </Pressable>
            <Pressable disabled={busy} onPress={() => { setRegistering((value) => !value); setConfirmPassword(""); }} style={styles.switchMode}><Text style={[styles.switchModeText, { color: palette.accent }]}>{registering ? "Already have an account? Sign in" : "Create account with invite"}</Text></Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 28, paddingBottom: 60 },
  mark: { width: 68, height: 68, borderRadius: 22, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  markText: { color: "white", fontSize: 32, fontWeight: "800" },
  title: { textAlign: "center", fontSize: 28, fontWeight: "800", marginTop: 18 },
  caption: { textAlign: "center", fontSize: 15, marginTop: 6 },
  form: { gap: 12, marginTop: 34 },
  input: { height: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, fontSize: 16 },
  error: { textAlign: "center", fontSize: 13 },
  submit: { height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 4 },
  submitText: { color: "white", fontSize: 16, fontWeight: "700" },
  switchMode: { minHeight: 42, alignItems: "center", justifyContent: "center" },
  switchModeText: { fontSize: 14, fontWeight: "600" },
});
