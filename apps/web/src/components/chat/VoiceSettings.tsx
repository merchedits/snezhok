import { useEffect } from "react";
import { useVoiceStore } from "../../stores/voiceStore.js";
import Button from "../Button.jsx";
import { useTranslation } from "../../i18n/index.jsx";

interface VoiceSettingsProps {
  onClose: () => void;
}

export default function VoiceSettings({ onClose }: VoiceSettingsProps) {
  const { 
    availableDevices, 
    selectedInputDeviceId, 
    selectedOutputDeviceId, 
    setInputDevice, 
    setOutputDevice,
    setAvailableDevices
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

  return (
    <div style={{
      position: 'absolute',
      top: 'calc(100% + 8px)',
      right: '0',
      backgroundColor: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-bg-subtle)',
      borderRadius: '14px',
      padding: 'var(--space-5)',
      width: '320px',
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

      <Button variant="ghost" onClick={onClose} style={{ marginTop: '4px' }}>
        {t('voice.close')}
      </Button>
    </div>
  );
}
