import { useEffect, useState } from "react";
import {
  Leaf,
  ArrowRight,
  LockKeyhole,
  Mail,
  ShieldCheck,
  LoaderCircle,
} from "lucide-react";
import * as api from "./api";
import type { components } from "./schema";
import "./auth.css";
export function AuthGate({ onReady }: { onReady: () => void }) {
  const [state, setState] = useState<components["schemas"]["AuthState"] | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [zone, setZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
  );
  useEffect(() => {
    api
      .authState()
      .then(setState)
      .catch((e) => setError(e.message));
  }, []);
  const returnUrl = new URL(location.href);
  returnUrl.searchParams.delete("auth_error");
  returnUrl.searchParams.delete("logged_out");
  const loginHref =
    (state?.login_url || "/api/v1/auth/login") +
    "?return_path=" +
    encodeURIComponent(returnUrl.pathname + returnUrl.search);
  const issue = new URLSearchParams(location.search).get("auth_error");
  const messages: Record<string, string> = {
    invalid_state:
      "That sign-in link expired or belongs to another browser. Start a new sign-in.",
    cancelled: "Sign-in was cancelled. You can try again.",
    sign_in_failed:
      "Sign-in could not be verified. Check your account's email verification and try again.",
    account_disabled:
      "This account is disabled. Contact the workspace operator.",
    unavailable: "Sign-in is not configured.",
  };
  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.redeemInvitation(token.trim(), zone);
      setToken("");
      onReady();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="auth-gate" aria-label="Workroom sign-in">
      <div className="auth-story">
        <span className="auth-leaf">
          <Leaf size={32} />
        </span>
        <span className="eyebrow">A PRIVATE SPACE FOR YOUR WORK</span>
        <h2>
          A little focus.
          <br />A place of your own.
        </h2>
        <p>
          Sign in to keep your tasks, conversations and source files together in
          your private workspace.
        </p>
        <div>
          <ShieldCheck size={18} />
          <span>
            Your account owns its workspace.
            <br />
            Every suggested change needs your approval.
          </span>
        </div>
      </div>
      <div className="auth-form-panel">
        <span className="auth-kind">
          <LockKeyhole size={14} />
          {state?.mode === "oidc" ? "Keycloak sign-in" : "Private access"}
        </span>
        {issue && (
          <p className="auth-feedback" role="alert">
            {messages[issue] || "Sign-in could not be completed. Try again."}
          </p>
        )}
        {new URLSearchParams(location.search).has("logged_out") && (
          <p className="auth-feedback">You are signed out of Workroom.</p>
        )}
        {error && (
          <p className="auth-feedback" role="alert">
            {error}
          </p>
        )}
        {!state ? (
          <p>
            <LoaderCircle size={20} className="spin" />
            Checking sign-in…
          </p>
        ) : state.mode === "unavailable" ? (
          <>
            <h3>Sign-in needs configuration.</h3>
            <p>
              The identity provider is not connected. Start the local Keycloak
              launcher or configure your server's OIDC settings.
            </p>
            <button className="secondary-button" onClick={onReady}>
              Check again
            </button>
          </>
        ) : state.authenticated ? (
          <>
            <h3>
              {state.has_workspace
                ? "Welcome back."
                : "Your invitation unlocks the workspace."}
            </h3>
            <p>
              Signed in as <strong>{state.email}</strong>
            </p>
            {state.has_workspace ? (
              <button className="primary-button" onClick={onReady}>
                Open my workspace <ArrowRight size={16} />
              </button>
            ) : (
              <form onSubmit={(e) => void redeem(e)}>
                <label className="form-field">
                  Invitation code
                  <input
                    type="password"
                    autoComplete="off"
                    required
                    minLength={16}
                    maxLength={200}
                    value={token}
                    disabled={busy}
                    onChange={(e) => setToken(e.target.value)}
                  />
                </label>
                <label className="form-field">
                  Workspace timezone
                  <input
                    required
                    value={zone}
                    disabled={busy}
                    onChange={(e) => setZone(e.target.value)}
                  />
                </label>
                <p className="auth-small">
                  Use the invitation issued for this verified email. Redeeming
                  it creates a new private workspace; it does not link you to
                  anyone else's data.
                </p>
                <button className="primary-button" disabled={busy}>
                  {busy ? "Opening…" : "Redeem invitation"}
                  <ArrowRight size={16} />
                </button>
              </form>
            )}
            <button
              className="auth-link"
              disabled={busy}
              onClick={() =>
                void api
                  .signOut(state.email || "")
                  .catch((e) => setError(e.message))
              }
            >
              Sign out or use another account
            </button>
          </>
        ) : (
          <>
            <h3>Welcome to Workroom.</h3>
            <p>
              Continue with your Keycloak account. New here? Choose Register on
              the sign-in page, verify your email, then redeem your invitation.
            </p>
            <a className="primary-button" href={loginHref}>
              Sign in with Keycloak
              <ArrowRight size={16} />
            </a>
            <details className="auth-recovery">
              <summary>
                Forgot your password or need to verify your email?
              </summary>
              <p>
                Open sign-in and choose <strong>Forgot password?</strong>{" "}
                Keycloak handles recovery and email verification. Workroom never
                receives your password.
              </p>
              {state.local_mail_url && (
                <a href={state.local_mail_url} target="_blank" rel="noreferrer">
                  <Mail size={14} />
                  Open local verification inbox
                </a>
              )}
              <p className="auth-small">
                This Docker setup captures emails locally; it does not send them
                to your real inbox.
              </p>
            </details>
          </>
        )}
        {state?.local_mail_url && (
          <span className="auth-local-note">
            Local Keycloak · development environment
          </span>
        )}
      </div>
    </section>
  );
}
