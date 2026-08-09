import { AppIcon, type AppIconName } from "../components/AppIcon";
import { type ComponentProps, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BrandMark } from "../components/BrandMark";
import { usePalette } from "../hooks/usePalette";
import { type TranslationKey, useTranslation } from "../i18n";
import { ApiError } from "../lib/api";
import { validEmail, validPassword, validUsername } from "../lib/authValidation";
import { userFacingError } from "../lib/userFacingError";
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
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.navigation }]}>
      <View pointerEvents="none" style={[styles.glow, { backgroundColor: palette.pop }]} />
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <BrandMark size={92} />
          <Text style={[styles.title, { color: "#FFFFFF" }]}>Snezhok</Text>
          <Text style={[styles.caption, { color: "rgba(255,255,255,0.78)" }]}>{registering ? t("registrationHint") : t("privateMessenger")}</Text>
          <View style={styles.form}>
            {registering ? <><AuthField icon="mail-outline" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder={t("email")} value={email} onChangeText={edit(setEmail)} invalid={Boolean(email && !emailIsValid)} />{email && !emailIsValid ? <Text style={[styles.fieldHint, { color: palette.danger }]}>{t("invalidEmail")}</Text> : null}</> : null}
            <AuthField icon="person-outline" autoCapitalize="none" autoCorrect={false} autoComplete="username" placeholder={t("username")} value={username} onChangeText={edit(setUsername)} invalid={Boolean(username && !usernameIsValid)} />
            {registering || (username && !usernameIsValid) ? <Text style={[styles.fieldHint, { color: username && !usernameIsValid ? palette.danger : palette.secondaryText }]}>{t("usernameRules")}</Text> : null}
            <View style={[styles.field, { backgroundColor: palette.surface, borderColor: password && !passwordIsValid ? palette.danger : palette.border }]}>
              <AppIcon name="lock-closed-outline" size={21} color={palette.faintText} />
              <TextInput autoCapitalize="none" autoComplete={registering ? "new-password" : "current-password"} placeholder={t("password")} placeholderTextColor={palette.faintText} secureTextEntry={!showPassword} value={password} onChangeText={edit(setPassword)} onSubmitEditing={() => void submit()} style={[styles.input, { color: palette.text }]} />
              <Pressable accessibilityLabel={showPassword ? t("hidePassword") : t("showPassword")} onPress={() => setShowPassword((value) => !value)} style={styles.eye}><AppIcon name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color={palette.faintText} /></Pressable>
            </View>
            {password && !passwordIsValid ? <Text style={[styles.fieldHint, { color: palette.danger }]}>{t("passwordRules")}</Text> : null}
            {registering ? <AuthField icon="shield-checkmark-outline" autoCapitalize="none" placeholder={t("confirmPassword")} secureTextEntry={!showPassword} value={confirmPassword} onChangeText={edit(setConfirmPassword)} onSubmitEditing={() => void submit()} invalid={Boolean(confirmPassword && confirmPassword !== password)} /> : null}
            {registering && confirmPassword && confirmPassword !== password ? <Text style={[styles.error, { color: palette.danger }]}>{t("passwordsMismatch")}</Text> : null}
            {localError || error ? <Text style={[styles.error, { color: palette.danger }]}>{localError ?? t("networkUnavailable")}</Text> : null}
            <Pressable accessibilityRole="button" onPress={() => void submit()} disabled={busy || !valid} style={({ pressed }) => [styles.submit, { backgroundColor: palette.pop, opacity: pressed || busy || !valid ? 0.58 : 1 }]}>
              {busy ? <ActivityIndicator color={palette.onPop} /> : <Text style={[styles.submitText, { color: palette.onPop }]}>{registering ? t("createAccount") : t("signIn")}</Text>}
            </Pressable>
            <Pressable disabled={busy} onPress={() => { setRegistering((value) => !value); setConfirmPassword(""); setLocalError(null); clearError(); }} style={styles.switchMode}><Text style={[styles.switchModeText, { color: "#FFFFFF" }]}>{registering ? t("alreadyRegistered") : t("needAccount")}</Text></Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type FieldProps = ComponentProps<typeof TextInput> & { icon: AppIconName; invalid?: boolean };

function AuthField({ icon, invalid, style: _style, ...props }: FieldProps) {
  const palette = usePalette();
  return <View style={[styles.field, { backgroundColor: palette.surface, borderColor: invalid ? palette.danger : palette.border }]}><AppIcon name={icon} size={21} color={palette.faintText} /><TextInput {...props} placeholderTextColor={palette.faintText} style={[styles.input, { color: palette.text }]} /></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  glow: { position: "absolute", width: 360, height: 360, borderRadius: 180, top: -260, right: -100, opacity: 0.9 },
  content: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 26, paddingVertical: 34 },
  title: { textAlign: "center", fontSize: 31, fontWeight: "800", marginTop: 17, letterSpacing: -0.5 },
  caption: { textAlign: "center", fontSize: 14, lineHeight: 20, marginTop: 5 },
  form: { gap: 11, marginTop: 30 },
  field: { minHeight: 54, borderRadius: 12, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 11 },
  input: { flex: 1, minHeight: 52, paddingVertical: 0, fontSize: 16 },
  eye: { width: 38, height: 44, alignItems: "center", justifyContent: "center" },
  error: { textAlign: "center", fontSize: 13, lineHeight: 18 },
  fieldHint: { fontSize: 11, lineHeight: 15, marginHorizontal: 6, marginTop: -6 },
  submit: { height: 54, borderRadius: 15, alignItems: "center", justifyContent: "center", marginTop: 3 },
  submitText: { fontSize: 16, fontWeight: "800" },
  switchMode: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  switchModeText: { fontSize: 14, fontWeight: "700" },
});

function authErrorMessage(error: unknown, t: (key: TranslationKey) => string): string {
  if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
    if (error.details?.email) return t("invalidEmail");
    if (error.details?.username) return t("usernameRules");
    if (error.details?.password) return t("passwordRules");
  }
  return userFacingError(error, t, "requestFailed");
}
