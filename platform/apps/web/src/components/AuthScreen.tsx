import { useState, type FormEvent } from "react";
import { Mail, UserRound } from "lucide-react";
import { useApp } from "../state/AppContext.js";
import { Spinner } from "./ui.js";

export function AuthScreen() {
  const { login, register, authError } = useApp();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "login") await login({ username, password });
      else await register({ username, password, email });
    } catch {
      // Error is exposed by the shared auth state.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-screen">
      <form className="auth-form" onSubmit={submit}>
        <div className="product-mark" aria-hidden="true">S</div>
        <h1>Snezhok</h1>
        <p>{mode === "login" ? "Sign in to continue." : "Create your account."}</p>

        {mode === "register" && (
          <label>
            Email
            <span className="field-with-icon"><Mail /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></span>
          </label>
        )}
        <label>
          Username
          <span className="field-with-icon"><UserRound /><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} maxLength={32} /></span>
        </label>
        <label>
          Password
          <input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
        </label>

        {authError && <p className="form-error" role="alert">{authError}</p>}
        <button className="button button-primary auth-submit" disabled={submitting}>{submitting ? <Spinner label="Signing in" /> : mode === "login" ? "Sign in" : "Create account"}</button>
        <button type="button" className="text-button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Create account" : "Back to sign in"}
        </button>
      </form>
    </main>
  );
}
