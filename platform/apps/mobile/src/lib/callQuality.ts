export type CallQuality = "data-saver" | "auto" | "high";

export interface CallMediaProfile {
  audioBitrate: number;
  camera: { width: number; height: number; frameRate: number; maxBitrate: number };
  screen: { width: number; height: number; frameRate: number; maxBitrate: number };
  simulcast: boolean;
}

const profiles: Record<CallQuality, CallMediaProfile> = {
  "data-saver": {
    audioBitrate: 20_000,
    camera: { width: 640, height: 360, frameRate: 20, maxBitrate: 350_000 },
    screen: { width: 960, height: 540, frameRate: 10, maxBitrate: 650_000 },
    simulcast: false,
  },
  auto: {
    audioBitrate: 32_000,
    camera: { width: 1280, height: 720, frameRate: 30, maxBitrate: 1_500_000 },
    screen: { width: 1280, height: 720, frameRate: 15, maxBitrate: 1_500_000 },
    simulcast: true,
  },
  high: {
    audioBitrate: 48_000,
    camera: { width: 1920, height: 1080, frameRate: 30, maxBitrate: 3_000_000 },
    screen: { width: 1920, height: 1080, frameRate: 30, maxBitrate: 3_500_000 },
    simulcast: true,
  },
};

export function callMediaProfile(callQuality: CallQuality, screenQuality: CallQuality): CallMediaProfile {
  const call = profiles[callQuality];
  const screen = profiles[screenQuality].screen;
  return { ...call, camera: { ...call.camera }, screen: { ...screen } };
}

/** Auto quality moves down quickly on poor links and recovers conservatively. */
export function adaptiveCallQuality(configured: CallQuality, connectionQuality: string): CallQuality {
  if (configured !== "auto") return configured;
  if (connectionQuality === "poor" || connectionQuality === "lost") return "data-saver";
  return "auto";
}
