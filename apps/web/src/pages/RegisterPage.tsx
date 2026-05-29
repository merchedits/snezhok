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
            setInviteCode("COZY_SNEZHOK"); // Fill bootstrap code automatically for convenience
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
        <div>
          <h1 className="auth-title">🌸 Create Account</h1>
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
              background: "var(--color-peach-soft)",
              color: "var(--color-text-primary)",
              borderRadius: "8px",
              fontSize: "var(--text-xs)",
              border: "1px solid var(--color-peach)",
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
            placeholder={isFirstSetup ? "COZY_SNEZHOK" : "Enter invite code..."}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            disabled={loading || isFirstSetup} // Autofilled and disabled if first setup
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

        <div style={{ textAlign: "center", fontSize: "var(--text-sm)" }}>
          <span style={{ color: "var(--color-text-secondary)" }}>
            Already have an account?{" "}
          </span>
          <a
            href="#login"
            style={{
              color: "var(--color-text-primary)",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Login
          </a>
        </div>
      </div>
    </div>
  );
}
