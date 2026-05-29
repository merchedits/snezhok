import { useVoiceStore } from "../../stores/voiceStore.js";
import Button from "../Button.jsx";

interface VoiceSettingsProps {
  onClose: () => void;
}

export default function VoiceSettings({ onClose }: VoiceSettingsProps) {
  const { 
    availableDevices, 
    selectedInputDeviceId, 
    selectedOutputDeviceId, 
    setInputDevice, 
    setOutputDevice 
  } = useVoiceStore();

  const audioInputs = availableDevices.filter((d) => d.kind === "audioinput");
  const audioOutputs = availableDevices.filter((d) => d.kind === "audiooutput");

  return (
    <div style={{
      position: 'absolute',
      bottom: '100%',
      right: '0',
      marginBottom: '8px',
      backgroundColor: 'var(--color-bg-elevated)',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-4)',
      width: '280px',
      boxShadow: 'var(--shadow-lg)',
      zIndex: 100,
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)'
    }}>
      <h3 style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>Voice Settings</h3>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>Microphone</label>
        <select
          value={selectedInputDeviceId || ""}
          onChange={(e) => setInputDevice(e.target.value || null)}
          style={{
            width: '100%',
            padding: '4px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-bg-base)',
            color: 'var(--color-text)',
            fontSize: 'var(--text-sm)'
          }}
        >
          <option value="">Default Input Device</option>
          {audioInputs.map(device => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Microphone ${device.deviceId.slice(0, 5)}...`}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>Output Device</label>
        <select
          value={selectedOutputDeviceId || ""}
          onChange={(e) => setOutputDevice(e.target.value || null)}
          style={{
            width: '100%',
            padding: '4px 8px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-bg-base)',
            color: 'var(--color-text)',
            fontSize: 'var(--text-sm)'
          }}
        >
          <option value="">Default Output Device</option>
          {audioOutputs.map(device => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Speaker ${device.deviceId.slice(0, 5)}...`}
            </option>
          ))}
        </select>
      </div>

      <Button variant="ghost" onClick={onClose} style={{ marginTop: '4px' }}>
        Close
      </Button>
    </div>
  );
}
