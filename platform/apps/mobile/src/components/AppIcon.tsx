import type { ComponentType } from "react";

import IconAdjustments from "@tabler/icons-react-native/IconAdjustments";
import IconAlertCircle from "@tabler/icons-react-native/IconAlertCircle";
import IconAlertTriangle from "@tabler/icons-react-native/IconAlertTriangle";
import IconAntennaBars5 from "@tabler/icons-react-native/IconAntennaBars5";
import IconArrowBackUp from "@tabler/icons-react-native/IconArrowBackUp";
import IconArrowForwardUp from "@tabler/icons-react-native/IconArrowForwardUp";
import IconArrowUp from "@tabler/icons-react-native/IconArrowUp";
import IconArrowsExchange from "@tabler/icons-react-native/IconArrowsExchange";
import IconArrowsMinimize from "@tabler/icons-react-native/IconArrowsMinimize";
import IconAccessible from "@tabler/icons-react-native/IconAccessible";
import IconBookmark from "@tabler/icons-react-native/IconBookmark";
import IconAt from "@tabler/icons-react-native/IconAt";
import IconBan from "@tabler/icons-react-native/IconBan";
import IconBell from "@tabler/icons-react-native/IconBell";
import IconCamera from "@tabler/icons-react-native/IconCamera";
import IconCheck from "@tabler/icons-react-native/IconCheck";
import IconChecks from "@tabler/icons-react-native/IconChecks";
import IconChevronDown from "@tabler/icons-react-native/IconChevronDown";
import IconChevronLeft from "@tabler/icons-react-native/IconChevronLeft";
import IconChevronRight from "@tabler/icons-react-native/IconChevronRight";
import IconChevronUp from "@tabler/icons-react-native/IconChevronUp";
import IconCircleArrowUp from "@tabler/icons-react-native/IconCircleArrowUp";
import IconCircleDot from "@tabler/icons-react-native/IconCircleDot";
import IconCirclePlus from "@tabler/icons-react-native/IconCirclePlus";
import IconClock from "@tabler/icons-react-native/IconClock";
import IconCloudDownload from "@tabler/icons-react-native/IconCloudDownload";
import IconCloudUpload from "@tabler/icons-react-native/IconCloudUpload";
import IconCopy from "@tabler/icons-react-native/IconCopy";
import IconDeviceMobile from "@tabler/icons-react-native/IconDeviceMobile";
import IconDots from "@tabler/icons-react-native/IconDots";
import IconDownload from "@tabler/icons-react-native/IconDownload";
import IconEar from "@tabler/icons-react-native/IconEar";
import IconEdit from "@tabler/icons-react-native/IconEdit";
import IconEye from "@tabler/icons-react-native/IconEye";
import IconEyeOff from "@tabler/icons-react-native/IconEyeOff";
import IconFile from "@tabler/icons-react-native/IconFile";
import IconFileText from "@tabler/icons-react-native/IconFileText";
import IconFolder from "@tabler/icons-react-native/IconFolder";
import IconGlobe from "@tabler/icons-react-native/IconGlobe";
import IconLanguage from "@tabler/icons-react-native/IconLanguage";
import IconLock from "@tabler/icons-react-native/IconLock";
import IconLogout from "@tabler/icons-react-native/IconLogout";
import IconMail from "@tabler/icons-react-native/IconMail";
import IconMapPin from "@tabler/icons-react-native/IconMapPin";
import IconMessageCircle from "@tabler/icons-react-native/IconMessageCircle";
import IconMessages from "@tabler/icons-react-native/IconMessages";
import IconMicrophone from "@tabler/icons-react-native/IconMicrophone";
import IconMicrophoneOff from "@tabler/icons-react-native/IconMicrophoneOff";
import IconMoon from "@tabler/icons-react-native/IconMoon";
import IconPalette from "@tabler/icons-react-native/IconPalette";
import IconPhone from "@tabler/icons-react-native/IconPhone";
import IconPhoto from "@tabler/icons-react-native/IconPhoto";
import IconPin from "@tabler/icons-react-native/IconPin";
import IconPlayerPause from "@tabler/icons-react-native/IconPlayerPause";
import IconPlayerPlay from "@tabler/icons-react-native/IconPlayerPlay";
import IconPlayerStop from "@tabler/icons-react-native/IconPlayerStop";
import IconPlus from "@tabler/icons-react-native/IconPlus";
import IconRepeat from "@tabler/icons-react-native/IconRepeat";
import IconRefresh from "@tabler/icons-react-native/IconRefresh";
import IconSearch from "@tabler/icons-react-native/IconSearch";
import IconServer from "@tabler/icons-react-native/IconServer";
import IconSettings from "@tabler/icons-react-native/IconSettings";
import IconShieldCheck from "@tabler/icons-react-native/IconShieldCheck";
import IconShield from "@tabler/icons-react-native/IconShield";
import IconSparkles from "@tabler/icons-react-native/IconSparkles";
import IconTrash from "@tabler/icons-react-native/IconTrash";
import IconUser from "@tabler/icons-react-native/IconUser";
import IconUserCircle from "@tabler/icons-react-native/IconUserCircle";
import IconUserPlus from "@tabler/icons-react-native/IconUserPlus";
import IconUserMinus from "@tabler/icons-react-native/IconUserMinus";
import IconVideo from "@tabler/icons-react-native/IconVideo";
import IconVideoOff from "@tabler/icons-react-native/IconVideoOff";
import IconVolume from "@tabler/icons-react-native/IconVolume";
import IconVolumeOff from "@tabler/icons-react-native/IconVolumeOff";
import IconWifi from "@tabler/icons-react-native/IconWifi";
import IconX from "@tabler/icons-react-native/IconX";

type TablerGlyph = ComponentType<{ size?: string | number; color?: string; strokeWidth?: string | number }>;

const glyphs = {
  "accessibility-outline": IconAccessible,
  "add-circle-outline": IconCirclePlus,
  add: IconPlus,
  "albums-outline": IconServer,
  albums: IconServer,
  "alert-circle": IconAlertCircle,
  "arrow-undo": IconArrowBackUp,
  "arrow-up-circle-outline": IconCircleArrowUp,
  "arrow-up": IconArrowUp,
  "at-outline": IconAt,
  "ban-outline": IconBan,
  bookmark: IconBookmark,
  call: IconPhone,
  "call-outline": IconPhone,
  camera: IconCamera,
  "cellular-outline": IconAntennaBars5,
  "chatbubble-outline": IconMessageCircle,
  "chatbubbles-outline": IconMessages,
  chatbubbles: IconMessages,
  "checkmark-done-outline": IconChecks,
  "checkmark-done": IconChecks,
  checkmark: IconCheck,
  "chevron-back": IconChevronLeft,
  "chevron-down": IconChevronDown,
  "chevron-forward": IconChevronRight,
  "chevron-up": IconChevronUp,
  close: IconX,
  "cloud-download-outline": IconCloudDownload,
  "cloud-upload-outline": IconCloudUpload,
  "color-palette-outline": IconPalette,
  "contract-outline": IconArrowsMinimize,
  "copy-outline": IconCopy,
  "create-outline": IconEdit,
  "document-outline": IconFile,
  "document-text-outline": IconFileText,
  "download-outline": IconDownload,
  "ear-outline": IconEar,
  "ellipsis-horizontal": IconDots,
  "eye-off-outline": IconEyeOff,
  "eye-outline": IconEye,
  "images-outline": IconPhoto,
  "folder-outline": IconFolder,
  "globe-outline": IconGlobe,
  "language-outline": IconLanguage,
  "location-outline": IconMapPin,
  "log-out-outline": IconLogout,
  "lock-closed-outline": IconLock,
  "mail-outline": IconMail,
  "mic-off": IconMicrophoneOff,
  "mic-outline": IconMicrophone,
  mic: IconMicrophone,
  "moon-outline": IconMoon,
  "notifications-outline": IconBell,
  "options-outline": IconAdjustments,
  pause: IconPlayerPause,
  "person-add-outline": IconUserPlus,
  "person-circle-outline": IconUserCircle,
  "person-circle": IconUserCircle,
  "person-remove-outline": IconUserMinus,
  "person-outline": IconUser,
  "phone-portrait-outline": IconDeviceMobile,
  "pin-outline": IconPin,
  pin: IconPin,
  play: IconPlayerPlay,
  "radio-button-on-outline": IconCircleDot,
  "repeat-outline": IconRepeat,
  "refresh-outline": IconRefresh,
  "return-down-back-outline": IconArrowBackUp,
  "return-up-forward-outline": IconArrowForwardUp,
  "return-up-forward": IconArrowForwardUp,
  search: IconSearch,
  "settings-outline": IconSettings,
  "server-outline": IconServer,
  "shield-outline": IconShield,
  settings: IconSettings,
  "shield-checkmark-outline": IconShieldCheck,
  "sparkles-outline": IconSparkles,
  stop: IconPlayerStop,
  "time-outline": IconClock,
  "swap-horizontal-outline": IconArrowsExchange,
  "trash-outline": IconTrash,
  "videocam-off": IconVideoOff,
  videocam: IconVideo,
  "volume-high": IconVolume,
  "volume-medium-outline": IconVolume,
  "volume-mute": IconVolumeOff,
  "warning-outline": IconAlertTriangle,
  "wifi-outline": IconWifi,
} as const satisfies Record<string, TablerGlyph>;

export type AppIconName = keyof typeof glyphs;

export function AppIcon({ name, size = 24, color, strokeWidth = 1.8 }: { name: AppIconName; size?: number; color: string; strokeWidth?: number }) {
  const Glyph = glyphs[name];
  return <Glyph size={size} color={color} strokeWidth={strokeWidth} />;
}
