import Ionicons from "@expo/vector-icons/Ionicons";
import { type ComponentProps, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandMark } from "../components/BrandMark";
import { usePalette } from "../hooks/usePalette";
import { type TranslationKey, useTranslation } from "../i18n";
import { ApiError } from "../lib/api";
import { validEmail, validPassword, validUsername } from "../lib/authValidation";
import { useAppStore } from "../store/useAppStore";

export function LoginScreen() {
  const palette = usePalette();
  const { t } = useTranslation();
  const signIn = useAppStore((state) => state.signIn);
  const signUp = useAppStore((state) => state.signUp);
  const clearError = useAppStore((state) => state.clearError);
  const error = useAppStore((state) => state.error);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [registering, setRegistering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const usernameIsValid = validUsername(username);
  const emailIsValid = validEmail(email);
  const passwordIsValid = validPassword(password);
  const valid = usernameIsValid && passwordIsValid && (!registering || (emailIsValid && password === confirmPassword));

  const edit = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setLocalError(null);
    clearError();
  };

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      if (registering) await signUp({ email: email.trim(), username: username.trim(), password });
      else await signIn(username, password);
    } catch (failure) {
      setLocalError(authErrorMessage(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.dark ? "#07111d" : palette.background }]}>
      <View pointerEvents="none" style={[styles.glow, { backgroundColor: palette.accentSoft }]} />
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <BrandMark size={92} />
          <Text style={[styles.title, { color: palette.text }]}>Snezhok</Text>
          <Text style={[styles.caption, { color: palette.secondaryText }]}>{registering ? t("registrationHint") : t("privateMessenger")}</Text>
          <View style={styles.form}>
            {registering ? <><AuthField icon="mail-outline" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder={t("email")} value={email} onChangeText={edit(setEmail)} invalid={Boolean(email && !emailIsValid)} />{email && !emailIsValid ? <Text style={[styles.fieldHint, { color: palette.danger }]}>{t("invalidEmail")}</Text> : null}</> : null}
            <AuthField icon="person-outline" autoCapitalize="none" autoCorrect={false} autoComplete="username" placeholder={t("username")} value={username} onChangeText={edit(setUsername)} invalid={Boolean(username && !usernameIsValid)} />
            {registering || (username && !usernameIsValid) ? <Text style={[styles.fieldHint, { color: username && !usernameIsValid ? palette.danger : palette.secondaryText }]}>{t("usernameRules")}</Text> : null}
            <View style={[styles.field, { backgroundColor: palette.surface, borderColor: password && !passwordIsValid ? palette.danger : palette.border }]}>
              <Ionicons name="lock-closed-outline" size={21} color={palette.faintText} />
              <TextInput autoCapitalize="none" autoComplete={registering ? "new-password" : "current-password"} placeholder={t("password")} placeholderTextColor={palette.faintText} secureTextEntry={!showPassword} value={password} onChangeText={edit(setPassword)} onSubmitEditing={() => void submit()} style={[styles.input, { color: palette.text }]} />
              <Pressable accessibilityLabel={showPassword ? "Hide password" : "Show password"} onPress={() => setShowPassword((value) => !value)} style={styles.eye}><Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color={palette.faintText} /></Pressable>
            </View>
            {password && !passwordIsValid ? <Text style={[styles.fieldHint, { color: palette.danger }]}>{t("passwordRules")}</Text> : null}
            {registering ? <AuthField icon="shield-checkmark-outline" autoCapitalize="none" placeholder={t("confirmPassword")} secureTextEntry={!showPassword} value={confirmPassword} onChangeText={edit(setConfirmPassword)} onSubmitEditing={() => void submit()} invalid={Boolean(confirmPassword && confirmPassword !== password)} /> : null}
            {registering && confirmPassword && confirmPassword !== password ? <Text style={[styles.error, { color: palette.danger }]}>{t("passwordsMismatch")}</Text> : null}
            {localError || error ? <Text style={[styles.error, { color: palette.danger }]}>{localError ?? error}</Text> : null}
            <Pressable accessibilityRole="button" onPress={() => void submit()} disabled={busy || !valid} style={({ pressed }) => [styles.submit, { backgroundColor: palette.accent, opacity: pressed || busy || !valid ? 0.58 : 1 }]}>
              {busy ? <ActivityIndicator color="white" /> : <Text style={styles.submitText}>{registering ? t("createAccount") : t("signIn")}</Text>}
            </Pressable>
            <Pressable disabled={busy} onPress={() => { setRegistering((value) => !value); setConfirmPassword(""); setLocalError(null); clearError(); }} style={styles.switchMode}><Text style={[styles.switchModeText, { color: palette.accent }]}>{registering ? t("alreadyRegistered") : t("needAccount")}</Text></Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type FieldProps = ComponentProps<typeof TextInput> & { icon: keyof typeof Ionicons.glyphMap; invalid?: boolean };

function AuthField({ icon, invalid, style: _style, ...props }: FieldProps) {
  const palette = usePalette();
  return <View style={[styles.field, { backgroundColor: palette.surface, borderColor: invalid ? palette.danger : palette.border }]}><Ionicons name={icon} size={21} color={palette.faintText} /><TextInput {...props} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text }]} /></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  glow: { position: "absolute", width: 420, height: 420, borderRadius: 210, top: -190, alignSelf: "center", opacity: 0.7 },
  content: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 26, paddingVertical: 34 },
  title: { textAlign: "center", fontSize: 31, fontWeight: "800", marginTop: 17, letterSpacing: -0.5 },
  caption: { textAlign: "center", fontSize: 14, lineHeight: 20, marginTop: 5 },
  form: { gap: 11, marginTop: 30 },
  field: { minHeight: 54, borderWidth: 1, borderRadius: 15, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 11 },
  input: { flex: 1, minHeight: 52, paddingVertical: 0, fontSize: 16 },
  eye: { width: 38, height: 44, alignItems: "center", justifyContent: "center" },
  error: { textAlign: "center", fontSize: 13, lineHeight: 18 },
  fieldHint: { fontSize: 11, lineHeight: 15, marginHorizontal: 6, marginTop: -6 },
  submit: { height: 54, borderRadius: 15, alignItems: "center", justifyContent: "center", marginTop: 3, elevation: 2 },
  submitText: { color: "white", fontSize: 16, fontWeight: "800" },
  switchMode: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  switchModeText: { fontSize: 14, fontWeight: "700" },
});

function authErrorMessage(error: unknown, t: (key: TranslationKey) => string): string {
  if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
    if (error.details?.email) return t("invalidEmail");
    if (error.details?.username) return t("usernameRules");
    if (error.details?.password) return t("passwordRules");
  }
  return error instanceof Error ? error.message : t("requestFailed");
}
