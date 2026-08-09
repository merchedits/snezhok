import {
  Archive, ArrowBendUpLeft, ArrowBendUpRight, ArrowCircleUp, ArrowClockwise, ArrowsLeftRight, ArrowUp, At, Bell,
  BookmarkSimple, Camera, CaretDown, CaretLeft, CaretRight, CaretUp, CellSignalFull, ChatCircleDots, ChatsCircle,
  Check, Checks, Clock, CloudArrowDown, CloudArrowUp, Copy, CornersIn, DeviceMobile, DotOutline, DotsThree,
  DownloadSimple, Ear, EnvelopeSimple, Eye, EyeSlash, File, FileText, FilmSlate, Folder, GearSix, Globe, Image,
  Lightbulb, Lightning, Lock, MagnifyingGlass, MapPin, Microphone, MicrophoneSlash, Moon, MusicNote, Palette,
  Pause, PencilSimple, PersonArmsSpread, Phone, Play, Plus, PlusCircle, Prohibit, PushPin, Question, Repeat,
  Shield, ShieldCheck, SignOut, SlidersHorizontal, Sparkle, SpeakerHigh, SpeakerSlash, Stack, Stop, Translate,
  Trash, User, UserCircle, UserMinus, UserPlus, VideoCamera, VideoCameraSlash, Warning, WarningCircle, WifiHigh, X,
  type PhosphorGlyph, type PhosphorWeight,
} from "../vendor/phosphorBridge";

const glyphs = {
  "accessibility-outline": PersonArmsSpread, "add-circle-outline": PlusCircle, add: Plus, "albums-outline": Stack, albums: Stack,
  "alert-circle": WarningCircle, "arrow-undo": ArrowBendUpLeft, "arrow-up-circle-outline": ArrowCircleUp, "arrow-up": ArrowUp,
  "at-outline": At, "ban-outline": Prohibit, bookmark: BookmarkSimple, call: Phone, "call-outline": Phone, camera: Camera,
  "cellular-outline": CellSignalFull, "chatbubble-outline": ChatCircleDots, "chatbubbles-outline": ChatsCircle, chatbubbles: ChatsCircle,
  "checkmark-done-outline": Checks, "checkmark-done": Checks, checkmark: Check, "chevron-back": CaretLeft, "chevron-down": CaretDown,
  "chevron-forward": CaretRight, "chevron-up": CaretUp, close: X, "cloud-download-outline": CloudArrowDown,
  "cloud-upload-outline": CloudArrowUp, "color-palette-outline": Palette, "contract-outline": CornersIn, "copy-outline": Copy,
  "create-outline": PencilSimple, "document-outline": File, "document-text-outline": FileText, "download-outline": DownloadSimple,
  "ear-outline": Ear, "ellipsis-horizontal": DotsThree, "eye-off-outline": EyeSlash, "eye-outline": Eye, "images-outline": Image,
  "folder-outline": Folder, "globe-outline": Globe, "language-outline": Translate, "location-outline": MapPin, "log-out-outline": SignOut,
  "lock-closed-outline": Lock, "mail-outline": EnvelopeSimple, "mic-off": MicrophoneSlash, "mic-outline": Microphone, mic: Microphone,
  "moon-outline": Moon, "notifications-outline": Bell, "options-outline": SlidersHorizontal, pause: Pause, "person-add-outline": UserPlus,
  "person-circle-outline": UserCircle, "person-circle": UserCircle, "person-remove-outline": UserMinus, "person-outline": User,
  "phone-portrait-outline": DeviceMobile, "pin-outline": PushPin, pin: PushPin, play: Play, "radio-button-on-outline": DotOutline,
  "repeat-outline": Repeat, "refresh-outline": ArrowClockwise, "return-down-back-outline": ArrowBendUpLeft,
  "return-up-forward-outline": ArrowBendUpRight, "return-up-forward": ArrowBendUpRight, search: MagnifyingGlass,
  "settings-outline": GearSix, "server-outline": Stack, "shield-outline": Shield, settings: GearSix,
  "shield-checkmark-outline": ShieldCheck, "sparkles-outline": Sparkle, stop: Stop, "time-outline": Clock,
  "swap-horizontal-outline": ArrowsLeftRight, "trash-outline": Trash, "videocam-off": VideoCameraSlash, videocam: VideoCamera,
  "volume-high": SpeakerHigh, "volume-medium-outline": SpeakerHigh, "volume-mute": SpeakerSlash, "warning-outline": Warning,
  "wifi-outline": WifiHigh, "help-circle-outline": Question, "bolt-outline": Lightning, "music-outline": MusicNote,
  "movie-outline": FilmSlate, "pencil-outline": PencilSimple, "bulb-outline": Lightbulb, "archive-outline": Archive,
} as const satisfies Record<string, PhosphorGlyph>;

export type AppIconName = keyof typeof glyphs;

export function AppIcon({ name, size = 24, color, strokeWidth = 2, weight }: { name: AppIconName; size?: number; color: string; strokeWidth?: number; weight?: PhosphorWeight }) {
  const Glyph = glyphs[name];
  return <Glyph size={size} color={color} weight={weight ?? (strokeWidth >= 1.9 ? "bold" : "regular")} />;
}
