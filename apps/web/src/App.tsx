import { useEffect, useState } from "react";
import { useAuthStore } from "./stores/authStore.js";
import { useSocket } from "./hooks/useSocket.js";
import LoginPage from "./pages/LoginPage.jsx";
import RegisterPage from "./pages/RegisterPage.jsx";
import ChatPage from "./pages/ChatPage.jsx";
import ConnectionBanner from "./components/ConnectionBanner.jsx";

export default function App() {
  const { isAuthenticated, checkingSession, checkSession } = useAuthStore();
  const socketConnected = useSocket();

  // Simple state-based router using window.location.hash
  const [route, setRoute] = useState<string>(window.location.hash || "#chat");

  useEffect(() => {
    // Check session on startup
    checkSession();

    const handleHashChange = () => {
      setRoute(window.location.hash || "#chat");
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Guard routing
  useEffect(() => {
    if (!checkingSession) {
      if (!isAuthenticated) {
        if (route !== "#register") {
          window.location.hash = "#login";
        }
      } else {
        if (route === "#login" || route === "#register") {
          window.location.hash = "#chat";
        }
      }
    }
  }, [isAuthenticated, checkingSession, route]);

  if (checkingSession) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "var(--color-bg-base)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-display)",
        fontSize: "var(--text-lg)",
        fontWeight: 600,
        gap: "8px"
      }}>
        🌸 Loading Snezhok...
      </div>
    );
  }

  // Handle rendering of current route
  const renderContent = () => {
    if (!isAuthenticated) {
      if (route === "#register") {
        return <RegisterPage />;
      }
      return <LoginPage />;
    }

    // Authenticated pages
    return <ChatPage />;
  };

  return (
    <>
      {isAuthenticated && !socketConnected && <ConnectionBanner />}
      {renderContent()}
    </>
  );
}
