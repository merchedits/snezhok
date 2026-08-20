import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { recordDiagnostic } from "../diagnostics/diagnostics";
import { usePalette } from "../hooks/usePalette";
import { useTranslation } from "../i18n";
import { AppIcon } from "./AppIcon";
import { isolatedContentComponentName } from "./contentFailureDiagnostics";

interface Props {
  contentKey: string;
  domain: "message" | "activity" | "composer";
  children: ReactNode;
}

interface BoundaryProps extends Props {
  title: string;
  retry: string;
  backgroundColor: string;
  borderColor: string;
  color: string;
  accent: string;
}

/** Local recovery boundary for independently renderable user-data subtrees. */
export function ContentFailureBoundary(props: Props) {
  const palette = usePalette();
  const { language } = useTranslation();
  return (
    <Boundary
      {...props}
      title={language === "ru" ? "Не удалось показать содержимое" : "Content could not be displayed"}
      retry={language === "ru" ? "Повторить" : "Retry"}
      backgroundColor={palette.surface}
      borderColor={palette.border}
      color={palette.secondaryText}
      accent={palette.accent}
    />
  );
}

class Boundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    recordDiagnostic("error", "crash", "Isolated content render failure", {
      domain: this.props.domain,
      name: error.name.slice(0, 80),
      component: isolatedContentComponentName(info.componentStack),
    });
  }

  componentDidUpdate(previous: BoundaryProps) {
    if (previous.contentKey !== this.props.contentKey && this.state.failed) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={[styles.fallback, { backgroundColor: this.props.backgroundColor, borderColor: this.props.borderColor }]}>
        <AppIcon name="warning-outline" size={20} color={this.props.color} />
        <Text numberOfLines={2} style={[styles.title, { color: this.props.color }]}>{this.props.title}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => this.setState({ failed: false })}
          style={styles.retry}
        >
          <Text style={[styles.retryText, { color: this.props.accent }]}>{this.props.retry}</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  fallback: {
    alignSelf: "center",
    maxWidth: 300,
    minHeight: 54,
    marginHorizontal: 12,
    marginVertical: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  title: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  retry: { minHeight: 36, paddingHorizontal: 6, justifyContent: "center" },
  retryText: { fontSize: 12, fontWeight: "800" },
});
