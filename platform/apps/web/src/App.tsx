import { useEffect } from "react";
import { MessageCircle } from "lucide-react";
import { AuthScreen } from "./components/AuthScreen.js";
import { CallSurface } from "./components/CallSurface.js";
import { ChatView } from "./components/ChatView.js";
import { FriendsView } from "./components/FriendsView.js";
import { Navigation } from "./components/Navigation.js";
import { Settings } from "./components/Settings.js";
import { Spinner } from "./components/ui.js";
import { useApp } from "./state/AppContext.js";

export function App() {
  const app = useApp();
  const settings = app.bootstrap?.settings;

  useEffect(() => {
    const root = document.documentElement;
    const theme = settings?.theme || "dark";
    root.dataset.theme = theme;
    root.dataset.accent = settings?.accent || "blue";
    root.dataset.density = settings?.density || "comfortable";
    root.dataset.contrast = settings?.highContrast ? "high" : "normal";
    root.style.setProperty("--font-scale", String(settings?.fontScale || 1));
    root.style.setProperty("--bubble-radius", `${settings?.bubbleRadius || 16}px`);
    root.classList.toggle("reduce-motion", Boolean(settings?.reducedMotion));
  }, [settings]);

  if (app.status === "checking") return <main className="boot-screen"><div className="product-mark">S</div><Spinner label="Loading Snezhok" /></main>;
  if (app.status === "guest" || !app.bootstrap) return <AuthScreen />;

  return (
    <div className="app-shell">
      {!app.online && <div className="offline-banner" role="status">Offline. Messages will send when connected.</div>}
      {app.online && !app.socketConnected && <div className="connection-indicator" role="status">Reconnecting...</div>}
      <Navigation />
      <main className="main-pane">{app.view === "friends" ? <FriendsView /> : app.selection ? <ChatView /> : <div className="empty-state"><MessageCircle /><p>No conversation selected.</p></div>}</main>
      <CallSurface />
      {app.settingsOpen && <Settings />}
      {app.toast && <div className="toast" role="status">{app.toast}</div>}
    </div>
  );
}
