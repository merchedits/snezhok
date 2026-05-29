import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getSocket } from "../lib/socket.js";
import Button from "./Button.jsx";

export default function ConnectionBanner() {
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    const socket = getSocket();
    
    const onReconnectAttempt = (attempt: number) => {
      setAttempts(attempt);
    };

    socket.io.on("reconnect_attempt", onReconnectAttempt);

    return () => {
      socket.io.off("reconnect_attempt", onReconnectAttempt);
    };
  }, []);

  const handleManualReconnect = () => {
    const socket = getSocket();
    socket.connect();
  };

  return (
    <div className="connection-banner" role="alert" aria-live="assertive" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
      <RefreshCw size={14} className={attempts > 0 ? "spin" : ""} />
      <span>
        {attempts > 0 
          ? `Connection lost. Reconnecting to Snezhok... (Attempt ${attempts})`
          : "Connection lost. Reconnecting to Snezhok..."}
      </span>
      {attempts > 5 && (
        <Button variant="ghost" onClick={handleManualReconnect} style={{ padding: '2px 8px', fontSize: '12px', minHeight: '24px' }}>
          Reconnect Now
        </Button>
      )}
    </div>
  );
}
