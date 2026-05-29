import { useState, useEffect } from "react";
import { useAuthStore } from "../stores/authStore.js";
import Input from "../components/Input.jsx";
import Button from "../components/Button.jsx";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const { login, loginError } = useAuthStore();

  useEffect(() => {
    // Check if there are any users in the DB. If not, redirect to registration
    const checkFirst = async () => {
      try {
        const res = await fetch("/api/auth/first");
        if (res.ok) {
          const data = await res.json();
          if (data.isFirst) {
            window.location.hash = "#register";
          }
        }
      } catch (err) {
        console.error(err);
      }
    };
    checkFirst();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setLoading(true);
    await login(username, password);
    setLoading(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div>
          <h1 className="auth-title">🌸 Snezhok</h1>
          <p className="auth-subtitle">Welcome back. Join the cozy room.</p>
        </div>

        {loginError && (
          <div
            style={{
              padding: "var(--space-2) var(--space-3)",
              background: "rgba(232, 146, 122, 0.15)",
              color: "var(--color-destructive)",
              borderRadius: "8px",
              fontSize: "var(--text-sm)",
              border: "1px solid rgba(232, 146, 122, 0.2)",
            }}
          >
            {loginError}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <Input
            label="Username"
            placeholder="Type your username..."
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            autoComplete="username"
            required
          />

          <Input
            label="Password"
            type="password"
            placeholder="Enter password..."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            autoComplete="current-password"
            required
          />

          <Button type="submit" disabled={loading}>
            {loading ? "Logging in..." : "Login"}
          </Button>
        </form>

        <div style={{ textAlign: "center", fontSize: "var(--text-sm)" }}>
          <span style={{ color: "var(--color-text-secondary)" }}>
            New here?{" "}
          </span>
          <a
            href="#register"
            style={{
              color: "var(--color-text-primary)",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Register with Invite Code
          </a>
        </div>
      </div>
    </div>
  );
}
