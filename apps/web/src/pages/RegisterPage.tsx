import { useState, useEffect } from "react";
import { useAuthStore } from "../stores/authStore.js";
import Input from "../components/Input.jsx";
import Button from "../components/Button.jsx";

export default function RegisterPage() {
  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [isFirstSetup, setIsFirstSetup] = useState(false);

  const { register, registerError } = useAuthStore();

  useEffect(() => {
    // Check if it's the first setup
    const checkFirst = async () => {
      try {
        const res = await fetch("/api/auth/first");
        if (res.ok) {
          const data = await res.json();
          if (data.isFirst) {
            setIsFirstSetup(true);
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
    if (!inviteCode.trim() || !username.trim() || !password) return;

    setLoading(true);
    await register(inviteCode.trim(), username.trim(), password, displayName.trim());
    setLoading(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-title-row">
            <span className="auth-logo">🌸</span>
            <h1 className="auth-title">Create Account</h1>
          </div>
          <p className="auth-subtitle">
            {isFirstSetup
              ? "Bootstrapping Snezhok. Create the first admin account."
              : "Register to join your friends."}
          </p>
        </div>

        {isFirstSetup && (
          <div
            style={{
              padding: "var(--space-2) var(--space-3)",
              background: "rgba(238, 165, 129, 0.12)",
              color: "rgba(255, 255, 255, 0.8)",
              borderRadius: "8px",
              fontSize: "var(--text-xs)",
              border: "1px solid rgba(238, 165, 129, 0.2)",
            }}
          >
            <strong>Note:</strong> You are the first user. This account will automatically become the Administrator.
          </div>
        )}

        {registerError && (
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
            {registerError}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <Input
            label="Invite Code"
            placeholder={isFirstSetup ? "Enter bootstrap invite code..." : "Enter invite code..."}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            disabled={loading}
            required
          />

          <Input
            label="Username"
            placeholder="Choose username (e.g. artem)..."
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            autoComplete="username"
            required
          />

          <Input
            label="Display Name (Optional)"
            placeholder="Enter public nickname (e.g. Artem)..."
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={loading}
            autoComplete="name"
          />

          <Input
            label="Password"
            type="password"
            placeholder="Create secure password..."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            autoComplete="new-password"
            required
          />

          <Button type="submit" disabled={loading}>
            {loading ? "Creating..." : "Create Account"}
          </Button>
        </form>

        <div className="auth-footer">
          <span>Already have an account? </span>
          <a href="#login">Login</a>
        </div>
      </div>
    </div>
  );
}
