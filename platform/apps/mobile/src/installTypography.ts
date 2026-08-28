import { Text, TextInput, type TextInputProps, type TextProps } from "react-native";

type ComponentWithDefaults<T> = { defaultProps?: T };

function mergeFontFamily<T extends TextProps | TextInputProps>(component: ComponentWithDefaults<T>) {
  component.defaultProps = {
    ...component.defaultProps,
    // Preserve Android accessibility scaling without allowing extreme display
    // settings to reflow critical controls into unusable multi-row layouts.
    maxFontSizeMultiplier: component.defaultProps?.maxFontSizeMultiplier ?? 1.35,
    style: [{ fontFamily: "Onest" }, component.defaultProps?.style],
  } as T;
}

/** Installs the embedded brand family before the first React tree is created. */
export function installTypography() {
  mergeFontFamily(Text as unknown as ComponentWithDefaults<TextProps>);
  mergeFontFamily(TextInput as unknown as ComponentWithDefaults<TextInputProps>);
}
