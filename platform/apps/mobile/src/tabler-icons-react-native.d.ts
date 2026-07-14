declare module "@tabler/icons-react-native/*" {
  import type { ForwardRefExoticComponent, RefAttributes } from "react";
  import type { Svg, SvgProps } from "react-native-svg";

  interface TablerIconProps extends SvgProps {
    size?: string | number;
    strokeWidth?: string | number;
    title?: string;
  }

  const icon: ForwardRefExoticComponent<TablerIconProps & RefAttributes<Svg>>;
  export default icon;
}
