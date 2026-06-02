import { useEffect } from "react";
import { useVoiceStore } from "../../stores/voiceStore.js";
import Button from "../Button.jsx";
import { useTranslation } from "../../i18n/index.jsx";
import { Clipboard, RefreshCw, Radio, Volume2 } from "lucide-react";

interface VoiceSettingsProps {
  onClose: () => void;
  onPlayLocalTestTone: () => void;
  onSendTestTone: () => void;
  onRequestDiagnostics: () => void;
}

export default function VoiceSettings({
  onClose,
  onPlayLocalTestTone,
  onSendTestTone,
  onRequestDiagnostics,
}: VoiceSettingsProps) {
  const { 
    availableDevices, 
    selectedInputDeviceId, 
    selectedOutputDeviceId, 
    setInputDevice, 
    setOutputDevice,
    setAvailableDevices,
    diagnostics
  } = useVoiceStore();

  const audioInputs = availableDevices.filter((d) => d.kind === "audioinput");
  const audioOutputs = availableDevices.filter((d) => d.kind === "audiooutput");
  const { t } = useTranslation();

  useEffect(() => {
    const hasEmptyLabels = audioInputs.length > 0 && !audioInputs[0].label;
    if (hasEmptyLabels) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          stream.getTracks().forEach(t => t.stop());
          return navigator.mediaDevices.enumerateDevices();
        })
        .then(devices => {
          setAvailableDevices(devices);
        })
        .catch(err => {
          console.error("Failed to request audio permissions for labels", err);
        });
    }
  }, [audioInputs, setAvailableDevices]);

  const copyDiagnostics = async () => {
    const payload = {
      ...diagnostics,
      copiedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      location: window.location.href,
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  };

  const formatTime = (value: number | null) => {
    if (!value) return "never";
    return new Date(value).toLocaleTimeString();
  };

  const Stat = ({ label, value }: { label: string; value: string | number }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "12px" }}>
      <span style={{ color: "var(--color-text-tertiary)" }}>{label}</span>
      <strong style={{ color: "var(--color-text-primary)", fontWeight: 600, fontFamily: "var(--font-body)" }}>{value}</strong>
    </div>
  );

  return (
    <div style={{
      position: 'absolute',
      top: 'calc(100% + 8px)',
      right: '0',
      backgroundColor: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-bg-subtle)',
      borderRadius: '14px',
      padding: 'var(--space-5)',
      width: '360px',
      maxWidth: 'calc(100vw - 24px)',
      boxShadow: '0 8px 32px rgba(60,40,25,0.12)',
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)'
    }}>
      <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontFamily: 'var(--font-display)', fontWeight: 700, color: 'var(--color-text-primary)' }}>{t('voice.voiceSettings')}</h3>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('voice.microphone')}</label>
        <select
          value={selectedInputDeviceId || ""}
          onChange={(e) => setInputDevice(e.target.value || null)}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '10px',
            border: '1px solid var(--color-bg-subtle)',
            backgroundColor: 'var(--color-bg-base)',
            color: 'var(--color-text-primary)',
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-body)',
            outline: 'none',
          }}
        >
          <option value="">{t('voice.defaultInput')}</option>
          {audioInputs.map(device => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <label style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>{t('voice.outputDevice')}</label>
        <select
          value={selectedOutputDeviceId || ""}
          onChange={(e) => setOutputDevice(e.target.value || null)}
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '10px',
            border: '1px solid var(--color-bg-subtle)',
            backgroundColor: 'var(--color-bg-base)',
            color: 'var(--color-text-primary)',
            fontSize: 'var(--text-sm)',
            fontFamily: 'var(--font-body)',
            outline: 'none',
          }}
        >
          <option value="">{t('voice.defaultOutput')}</option>
          {audioOutputs.map(device => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Speaker ${device.deviceId.slice(0, 5)}...`}
            </option>
          ))}
        </select>
      </div>

      <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "12px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <h4 style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", fontFamily: "var(--font-body)" }}>
          Voice diagnostics
        </h4>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <Button variant="ghost" onClick={onPlayLocalTestTone} style={{ height: "34px", fontSize: "12px", padding: "0 10px" }}>
            <Volume2 size={14} />
            Local tone
          </Button>
          <Button variant="ghost" onClick={onSendTestTone} style={{ height: "34px", fontSize: "12px", padding: "0 10px" }}>
            <Radio size={14} />
            Send tone
          </Button>
          <Button variant="ghost" onClick={onRequestDiagnostics} style={{ height: "34px", fontSize: "12px", padding: "0 10px" }}>
            <RefreshCw size={14} />
            Snapshot
          </Button>
          <Button variant="ghost" onClick={copyDiagnostics} style={{ height: "34px", fontSize: "12px", padding: "0 10px" }}>
            <Clipboard size={14} />
            Copy
          </Button>
        </div>

        <div style={{ padding: "10px", borderRadius: "10px", background: "var(--color-bg-base)", border: "1px solid var(--color-border)", display: "flex", flexDirection: "column", gap: "5px" }}>
          <Stat label="Socket" value={diagnostics.socketConnected ? `connected ${diagnostics.socketId || ""}` : "not connected"} />
          <Stat label="Call" value={diagnostics.conversationId || "none"} />
          <Stat label="Capture" value={diagnostics.captureActive ? `${diagnostics.captureContextState} ${Math.round(diagnostics.localRms * 1000) / 1000}` : diagnostics.captureContextState} />
          <Stat label="Input" value={diagnostics.inputDeviceLabel} />
          <Stat label="Sent" value={`${diagnostics.framesSent} frames / ${diagnostics.bytesSent} B`} />
          <Stat label="Server got" value={`${diagnostics.serverFramesReceived} frames / recipients ${diagnostics.serverRecipients}`} />
          <Stat label="Received" value={`${diagnostics.framesReceived} frames / ${diagnostics.bytesReceived} B`} />
          <Stat label="Played" value={`${diagnostics.framesPlayed} frames / ${diagnostics.playbackContextState}`} />
          <Stat label="Last send" value={formatTime(diagnostics.lastSendAt)} />
          <Stat label="Last server ack" value={formatTime(diagnostics.lastServerAckAt)} />
          <Stat label="Last receive" value={formatTime(diagnostics.lastReceiveAt)} />
          <Stat label="Drops" value={diagnostics.serverDroppedFrames} />
        </div>

        <div style={{ maxHeight: "120px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
          {diagnostics.events.length === 0 ? (
            <p style={{ margin: 0, fontSize: "12px", color: "var(--color-text-tertiary)" }}>No diagnostic events yet.</p>
          ) : diagnostics.events.map((event) => (
            <div
              key={event.id}
              style={{
                fontSize: "12px",
                lineHeight: 1.35,
                color: event.level === "error" ? "var(--color-destructive)" : event.level === "warn" ? "var(--color-peach-dark)" : "var(--color-text-secondary)",
              }}
            >
              {formatTime(event.at)} - {event.message}
            </div>
          ))}
        </div>
      </div>

      <Button variant="ghost" onClick={onClose} style={{ marginTop: '4px' }}>
        {t('voice.close')}
      </Button>
    </div>
  );
}
