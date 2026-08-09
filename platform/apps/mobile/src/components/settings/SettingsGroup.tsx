import * as Haptics from "expo-haptics";
import { Children, Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Switch, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../../hooks/usePalette";
import { useUiPreferences } from "../../hooks/useUiPreferences";
import { AppIcon, type AppIconName } from "../AppIcon";

export interface SettingsChoiceOption {
  value: string;
  label: string;
  color?: string;
}

export type SettingsCardTone = "pink" | "coral" | "butter" | "lime" | "mint" | "tangerine" | "lavender" | "sky";

export function SettingsSection({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  const palette = usePalette();
  const ui = useUiPreferences();
  return (
    <View style={styles.section}>
      {title ? <Text style={[styles.sectionTitle, { color: palette.text, fontSize: ui.font(15), lineHeight: ui.font(20) }]}>{title}</Text> : null}
      <View style={styles.cardStack}>{children}</View>
      {footer ? <View style={styles.footer}>{typeof footer === "string" ? <Text style={[styles.footerText, { color: palette.secondaryText, fontSize: ui.font(12), lineHeight: ui.font(17) }]}>{footer}</Text> : footer}</View> : null}
    </View>
  );
}

export function SettingsCard({ children, tone }: { children: ReactNode; tone?: SettingsCardTone }) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const rows = Children.toArray(children);
  return (
    <View style={[styles.card, { borderRadius: Math.max(18, ui.bubbleRadius), backgroundColor: settingsTone(palette, tone) }]}>
      {rows.map((row, index) => (
        <Fragment key={index}>
          {row}
          {index < rows.length - 1 ? <View style={[styles.divider, { backgroundColor: palette.border }]} /> : null}
        </Fragment>
      ))}
    </View>
  );
}

export function SettingsRow({
  icon,
  label,
  detail,
  value,
  valueColor,
  valueDot,
  onPress,
  disabled = false,
}: {
  icon: AppIconName;
  label: string;
  detail?: string | null;
  value?: string | null;
  valueColor?: string;
  valueDot?: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const content = (
    <>
      <View style={styles.iconSlot}><AppIcon name={icon} size={22} color={palette.accent} strokeWidth={1.9} /></View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.label, { color: palette.text, fontSize: ui.font(15), lineHeight: ui.font(20) }]}>{label}</Text>
        {detail ? <Text numberOfLines={2} style={[styles.detail, { color: palette.secondaryText, fontSize: ui.font(12), lineHeight: ui.font(16) }]}>{detail}</Text> : null}
      </View>
      {valueDot ? <View style={[styles.valueDot, { backgroundColor: valueDot }]} /> : null}
      {value ? <Text numberOfLines={1} style={[styles.value, { color: valueColor ?? palette.secondaryText, fontSize: ui.font(14), lineHeight: ui.font(19) }]}>{value}</Text> : null}
    </>
  );

  if (!onPress) return <View style={[styles.row, { minHeight: ui.dense(56, 48), paddingVertical: ui.dense(8, 5) }, disabled && styles.disabled]}>{content}</View>;
  const activate = () => {
    void Haptics.selectionAsync().catch(() => undefined);
    onPress();
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={value ? { text: value } : undefined}
      disabled={disabled}
      onPress={activate}
      style={({ pressed }) => [styles.row, { minHeight: ui.dense(56, 48), paddingVertical: ui.dense(8, 5) }, disabled && styles.disabled, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export function SettingsSwitchRow({ icon, label, value, onChange }: { icon: AppIconName; label: string; value: boolean; onChange: (value: boolean) => void }) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const immediateValue = useRef(value);
  useEffect(() => { immediateValue.current = value; }, [value]);
  const toggle = () => {
    const next = !immediateValue.current;
    immediateValue.current = next;
    void Haptics.selectionAsync().catch(() => undefined);
    onChange(next);
  };
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={toggle}
      style={({ pressed }) => [styles.row, { minHeight: ui.dense(56, 48), paddingVertical: ui.dense(8, 5) }, pressed && styles.pressed]}
    >
      <View style={styles.iconSlot}><AppIcon name={icon} size={22} color={palette.accent} strokeWidth={1.9} /></View>
      <Text numberOfLines={2} style={[styles.label, styles.switchLabel, { color: palette.text, fontSize: ui.font(15), lineHeight: ui.font(20) }]}>{label}</Text>
      <View pointerEvents="none">
        <Switch
          value={value}
          trackColor={{ false: palette.border, true: palette.accent }}
          thumbColor="#ffffff"
          ios_backgroundColor={palette.border}
        />
      </View>
    </Pressable>
  );
}

export function SettingsChoiceSheet({
  visible,
  title,
  selected,
  options,
  cancelLabel,
  reducedMotion = false,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  selected: string;
  options: readonly SettingsChoiceOption[];
  cancelLabel: string;
  reducedMotion?: boolean;
  onSelect: (value: string) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const ui = useUiPreferences();
  const insets = useSafeAreaInsets();
  const { height: viewportHeight } = useWindowDimensions();
  const [presented, setPresented] = useState(visible);
  const [display, setDisplay] = useState({ title, selected, options });
  const latestDisplay = useRef({ title, selected, options });
  latestDisplay.current = { title, selected, options };
  // Keep the sheet completely below the native modal until `onShow` confirms
  // that Android has attached the modal window. Animating before that callback
  // produces a few frames in the old React root above the app tab bar.
  const progress = useRef(new Animated.Value(0)).current;
  const selecting = useRef(false);
  const presentedRef = useRef(presented);
  presentedRef.current = presented;

  const enter = useCallback(() => {
    progress.stopAnimation();
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    requestAnimationFrame(() => {
      Animated.timing(progress, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    });
  }, [progress, reducedMotion]);

  useEffect(() => {
    selecting.current = false;
    progress.stopAnimation();
    if (visible) {
      setDisplay(latestDisplay.current);
      progress.setValue(0);
      if (presentedRef.current) enter();
      else setPresented(true);
      return;
    }
    if (reducedMotion) {
      progress.setValue(0);
      setPresented(false);
      return;
    }
    Animated.timing(progress, { toValue: 0, duration: 170, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished) {
        presentedRef.current = false;
        setPresented(false);
      }
    });
  }, [enter, progress, reducedMotion, visible]);

  if (!presented) return null;
  const choose = (value: string) => {
    if (selecting.current) return;
    selecting.current = true;
    void Haptics.selectionAsync().catch(() => undefined);
    onSelect(value);
  };
  const sheetTranslateY = progress.interpolate({ inputRange: [0, 1], outputRange: [Math.max(viewportHeight, 480), 0] });
  return (
    <Modal
      visible={presented}
      transparent
      statusBarTranslucent
      navigationBarTranslucent={false}
      hardwareAccelerated
      animationType="none"
      presentationStyle="overFullScreen"
      onShow={enter}
      onRequestClose={onClose}
    >
      <View style={styles.modalLayer}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: progress, backgroundColor: palette.overlay }]} />
        <Pressable accessibilityRole="button" accessibilityLabel={cancelLabel} onPress={onClose} style={StyleSheet.absoluteFill} />
        <Animated.View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + 12, 24), backgroundColor: palette.elevated, transform: [{ translateY: sheetTranslateY }] }]}>
          <View style={[styles.grabber, { backgroundColor: palette.faintText }]} />
          <Text style={[styles.sheetTitle, { color: palette.text, fontSize: ui.font(18), lineHeight: ui.font(23) }]}>{display.title}</Text>
          <View style={[styles.options, { backgroundColor: palette.surface }]}>
            {display.options.map((option, index) => {
              const active = option.value === display.selected;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => choose(option.value)}
                  style={({ pressed }) => [
                    styles.choice,
                    { minHeight: ui.dense(52, 46) },
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
                    pressed && styles.pressed,
                  ]}
                >
                  {option.color ? <View style={[styles.choiceDot, { backgroundColor: option.color }]} /> : null}
                  <Text style={[styles.choiceLabel, { color: active ? palette.accent : palette.text, fontSize: ui.font(15), lineHeight: ui.font(20) }]}>{option.label}</Text>
                  {active ? <AppIcon name="checkmark" size={20} color={palette.accent} strokeWidth={2.2} /> : <View style={styles.checkPlaceholder} />}
                </Pressable>
              );
            })}
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.cancel, { backgroundColor: palette.surface }, pressed && styles.pressed]}>
            <Text style={[styles.cancelText, { color: palette.accent, fontSize: ui.font(15), lineHeight: ui.font(20) }]}>{cancelLabel}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionTitle: { marginLeft: 4, fontSize: 15, lineHeight: 20, fontWeight: "800", letterSpacing: -0.2 },
  cardStack: { gap: 12 },
  card: { borderRadius: 18, overflow: "hidden" },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 52 },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8 },
  iconSlot: { width: 38, alignItems: "flex-start", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, justifyContent: "center" },
  label: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
  detail: { marginTop: 2, fontSize: 12, lineHeight: 16 },
  value: { maxWidth: "43%", marginLeft: 12, fontSize: 14, lineHeight: 19, fontWeight: "500", textAlign: "right" },
  valueDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 10, marginRight: -6 },
  switchLabel: { flex: 1, paddingRight: 12 },
  footer: { paddingHorizontal: 6 },
  footerText: { fontSize: 12, lineHeight: 17 },
  disabled: { opacity: 0.52 },
  pressed: { opacity: 0.62 },
  modalLayer: { flex: 1, justifyContent: "flex-end" },
  sheet: { maxHeight: "86%", borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 12, paddingTop: 8 },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", opacity: 0.55 },
  sheetTitle: { paddingHorizontal: 10, paddingTop: 14, paddingBottom: 10, fontSize: 18, lineHeight: 23, fontWeight: "800" },
  options: { overflow: "hidden", borderRadius: 18 },
  choice: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
  choiceDot: { width: 10, height: 10, borderRadius: 5, marginRight: 11 },
  choiceLabel: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: "600" },
  checkPlaceholder: { width: 20 },
  cancel: { minHeight: 50, marginTop: 10, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
});

function settingsTone(palette: ReturnType<typeof usePalette>, tone?: SettingsCardTone) {
  void tone;
  return palette.group.neutral;
}
