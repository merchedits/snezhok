import * as Haptics from "expo-haptics";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { enqueueUniqueDialog, normalizeDialogActions, type AppDialogAction } from "../lib/dialogActions";

export type { AppDialogAction } from "../lib/dialogActions";

export interface AppDialogOptions {
  dismissible?: boolean;
}

export type ShowAppDialog = (
  title: string,
  message?: string,
  actions?: AppDialogAction[],
  options?: AppDialogOptions,
) => void;

interface DialogRequest {
  id: number;
  title: string;
  message?: string;
  actions: AppDialogAction[];
  dismissible: boolean;
}

const DialogContext = createContext<ShowAppDialog | null>(null);
let nextDialogId = 1;

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [dialogs, setDialogs] = useState<DialogRequest[]>([]);
  const showDialog = useCallback<ShowAppDialog>((title, message, actions, options) => {
    const request: DialogRequest = {
      id: nextDialogId++,
      title,
      ...(message ? { message } : {}),
      actions: normalizeDialogActions(actions, t("ok")),
      dismissible: options?.dismissible !== false,
    };
    setDialogs((current) => enqueueUniqueDialog(current, request));
  }, [t]);
  const value = useMemo(() => showDialog, [showDialog]);
  const active = dialogs[0] ?? null;
  const dismiss = useCallback(() => setDialogs((current) => current.slice(1)), []);

  return (
    <DialogContext.Provider value={value}>
      {children}
      <SnezhokDialog dialog={active} onDismiss={dismiss} />
    </DialogContext.Provider>
  );
}

export function useAppDialog(): ShowAppDialog {
  const dialog = useContext(DialogContext);
  if (!dialog) throw new Error("useAppDialog must be used inside AppDialogProvider");
  return dialog;
}

function SnezhokDialog({ dialog, onDismiss }: { dialog: DialogRequest | null; onDismiss: () => void }) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const actionLocked = useRef(false);
  useEffect(() => { actionLocked.current = false; }, [dialog?.id]);
  const dismissOnce = () => {
    if (actionLocked.current) return;
    actionLocked.current = true;
    onDismiss();
  };
  const activate = (action: AppDialogAction) => {
    if (actionLocked.current) return;
    actionLocked.current = true;
    void Haptics.selectionAsync().catch(() => undefined);
    onDismiss();
    action.onPress?.();
  };
  return (
    <Modal
      visible={Boolean(dialog)}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={() => { if (dialog?.dismissible) dismissOnce(); }}
    >
      <View
        accessibilityViewIsModal
        accessibilityLabel={dialog?.title}
        onAccessibilityEscape={() => { if (dialog?.dismissible) dismissOnce(); }}
        style={[styles.layer, { paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 20) }]}
      >
        <Pressable
          accessible={false}
          disabled={!dialog?.dismissible}
          onPress={dismissOnce}
          style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]}
        />
        {dialog ? <View style={[styles.card, { backgroundColor: palette.elevated, shadowColor: palette.outline }]}>
          <View style={[styles.accent, { backgroundColor: palette.pop }]} />
          <Text accessibilityRole="header" style={[styles.title, { color: palette.text }]}>{dialog.title}</Text>
          {dialog.message ? <Text style={[styles.message, { color: palette.secondaryText }]}>{dialog.message}</Text> : null}
          <View style={[styles.actions, { borderColor: palette.border }]}>
            {dialog.actions.map((action, index) => {
              const destructive = action.style === "destructive";
              const primary = !destructive && action.style !== "cancel" && dialog.actions.length === 1;
              return <Pressable
                key={`${action.text}-${index}`}
                accessibilityRole="button"
                accessibilityLabel={action.text}
                onPress={() => activate(action)}
                style={({ pressed }) => [
                  styles.action,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
                  primary && { backgroundColor: palette.accent },
                  pressed && { opacity: 0.62 },
                ]}
              >
                <Text style={[styles.actionText, { color: primary ? palette.onAccent : destructive ? palette.danger : action.style === "cancel" ? palette.secondaryText : palette.accent }]}>{action.text}</Text>
              </Pressable>;
            })}
          </View>
        </View> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  card: { width: "100%", maxWidth: 390, borderRadius: 24, overflow: "hidden", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 18, elevation: 16 },
  accent: { width: 52, height: 7, borderRadius: 4, alignSelf: "center", marginTop: 13 },
  title: { paddingHorizontal: 22, paddingTop: 18, fontSize: 21, lineHeight: 26, fontWeight: "800", textAlign: "center" },
  message: { paddingHorizontal: 22, paddingTop: 9, paddingBottom: 19, fontSize: 14, lineHeight: 20, textAlign: "center" },
  actions: { borderTopWidth: StyleSheet.hairlineWidth },
  action: { minHeight: 52, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  actionText: { fontSize: 15, lineHeight: 19, fontWeight: "700", textAlign: "center" },
});
