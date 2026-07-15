import * as Haptics from "expo-haptics";
import { Children, Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePalette } from "../../hooks/usePalette";
import { AppIcon, type AppIconName } from "../AppIcon";

export interface SettingsChoiceOption {
  value: string;
  label: string;
  color?: string;
}

export function SettingsSection({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  const palette = usePalette();
  return (
    <View style={styles.section}>
      {title ? <Text style={[styles.sectionTitle, { color: palette.secondaryText }]}>{title}</Text> : null}
      <View style={styles.cardStack}>{children}</View>
      {footer ? <View style={styles.footer}>{typeof footer === "string" ? <Text style={[styles.footerText, { color: palette.secondaryText }]}>{footer}</Text> : footer}</View> : null}
    </View>
  );
}

export function SettingsCard({ children }: { children: ReactNode }) {
  const palette = usePalette();
  const rows = Children.toArray(children);
  return (
    <View style={[styles.card, { backgroundColor: palette.dark ? palette.elevated : palette.background, borderColor: palette.border }]}>
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
  const content = (
    <>
      <View style={styles.iconSlot}><AppIcon name={icon} size={22} color={palette.accent} strokeWidth={1.9} /></View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.label, { color: palette.text }]}>{label}</Text>
        {detail ? <Text numberOfLines={2} style={[styles.detail, { color: palette.secondaryText }]}>{detail}</Text> : null}
      </View>
      {valueDot ? <View style={[styles.valueDot, { backgroundColor: valueDot }]} /> : null}
      {value ? <Text numberOfLines={1} style={[styles.value, { color: valueColor ?? palette.secondaryText }]}>{value}</Text> : null}
    </>
  );

  if (!onPress) return <View style={[styles.row, disabled && styles.disabled]}>{content}</View>;
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
      android_ripple={{ color: palette.accentSoft }}
      style={({ pressed }) => [styles.row, disabled && styles.disabled, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export function SettingsSwitchRow({ icon, label, value, onChange }: { icon: AppIconName; label: string; value: boolean; onChange: (value: boolean) => void }) {
  const palette = usePalette();
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
      android_ripple={{ color: palette.accentSoft }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.iconSlot}><AppIcon name={icon} size={22} color={palette.accent} strokeWidth={1.9} /></View>
      <Text numberOfLines={2} style={[styles.label, styles.switchLabel, { color: palette.text }]}>{label}</Text>
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
  const insets = useSafeAreaInsets();
  const [presented, setPresented] = useState(visible);
  const [display, setDisplay] = useState({ title, selected, options });
  const latestDisplay = useRef({ title, selected, options });
  latestDisplay.current = { title, selected, options };
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const selecting = useRef(false);

  useEffect(() => {
    selecting.current = false;
    progress.stopAnimation();
    if (visible) {
      setDisplay(latestDisplay.current);
      setPresented(true);
      if (reducedMotion) {
        progress.setValue(1);
        return;
      }
      progress.setValue(0);
      requestAnimationFrame(() => {
        Animated.timing(progress, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      });
      return;
    }
    if (reducedMotion) {
      progress.setValue(0);
      setPresented(false);
      return;
    }
    Animated.timing(progress, { toValue: 0, duration: 170, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setPresented(false);
    });
  }, [progress, reducedMotion, visible]);

  if (!presented) return null;
  const choose = (value: string) => {
    if (selecting.current) return;
    selecting.current = true;
    void Haptics.selectionAsync().catch(() => undefined);
    onSelect(value);
  };
  const sheetTranslateY = progress.interpolate({ inputRange: [0, 1], outputRange: [36, 0] });
  const sheetScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.99, 1] });
  return (
    <Modal
      visible={presented}
      transparent
      statusBarTranslucent
      navigationBarTranslucent={false}
      hardwareAccelerated
      animationType="none"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.modalLayer}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: progress, backgroundColor: palette.overlay }]} />
        <Pressable accessibilityRole="button" accessibilityLabel={cancelLabel} onPress={onClose} style={StyleSheet.absoluteFill} />
        <Animated.View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom + 12, 24), backgroundColor: palette.dark ? palette.elevated : palette.background, borderColor: palette.border, opacity: progress, transform: [{ translateY: sheetTranslateY }, { scale: sheetScale }] }]}>
          <View style={[styles.grabber, { backgroundColor: palette.faintText }]} />
          <Text style={[styles.sheetTitle, { color: palette.text }]}>{display.title}</Text>
          <View style={styles.options}>
            {display.options.map((option, index) => {
              const active = option.value === display.selected;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => choose(option.value)}
                  android_ripple={{ color: palette.accentSoft }}
                  style={({ pressed }) => [
                    styles.choice,
                    index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.border },
                    pressed && styles.pressed,
                  ]}
                >
                  {option.color ? <View style={[styles.choiceDot, { backgroundColor: option.color }]} /> : null}
                  <Text style={[styles.choiceLabel, { color: active ? palette.accent : palette.text }]}>{option.label}</Text>
                  {active ? <AppIcon name="checkmark" size={20} color={palette.accent} strokeWidth={2.2} /> : <View style={styles.checkPlaceholder} />}
                </Pressable>
              );
            })}
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.cancel, { backgroundColor: palette.surface }, pressed && styles.pressed]}>
            <Text style={[styles.cancelText, { color: palette.accent }]}>{cancelLabel}</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionTitle: { marginLeft: 4, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  cardStack: { gap: 12 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: "hidden" },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 52 },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 8 },
  iconSlot: { width: 38, alignItems: "flex-start", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, justifyContent: "center" },
  label: { fontSize: 15, lineHeight: 20, fontWeight: "600" },
  detail: { marginTop: 2, fontSize: 12, lineHeight: 16 },
  value: { maxWidth: "43%", marginLeft: 12, fontSize: 14, lineHeight: 19, fontWeight: "500", textAlign: "right" },
  valueDot: { width: 8, height: 8, borderRadius: 4, marginLeft: 10, marginRight: -6 },
  switchLabel: { flex: 1, paddingRight: 12 },
  footer: { paddingHorizontal: 6 },
  footerText: { fontSize: 12, lineHeight: 17 },
  disabled: { opacity: 0.52 },
  pressed: { opacity: 0.62 },
  modalLayer: { flex: 1, justifyContent: "flex-end" },
  sheet: { maxHeight: "86%", borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 12, paddingTop: 8 },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", opacity: 0.55 },
  sheetTitle: { paddingHorizontal: 10, paddingTop: 14, paddingBottom: 10, fontSize: 18, lineHeight: 23, fontWeight: "800" },
  options: { overflow: "hidden", borderRadius: 14 },
  choice: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
  choiceDot: { width: 10, height: 10, borderRadius: 5, marginRight: 11 },
  choiceLabel: { flex: 1, fontSize: 15, lineHeight: 20, fontWeight: "600" },
  checkPlaceholder: { width: 20 },
  cancel: { minHeight: 50, marginTop: 10, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, lineHeight: 20, fontWeight: "700" },
});
