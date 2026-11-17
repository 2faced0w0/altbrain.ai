import { Check, Clock3, LockKeyhole, Settings2, Sparkles } from "lucide-react";
import * as api from "./api";
import type { Profile } from "./api";
import type { TrackerApp } from "./useTrackerApp";

export function SettingsPage({
  app,
  profile,
}: {
  app: TrackerApp;
  profile: Profile;
}) {
  const { setProfile, aiStatus, setError, setNotice, zone } = app;
  return (
    <div className="settings-grid">
      <section className="settings-card">
        <span className="card-label">
          <Settings2 size={17} /> WORKSPACE PREFERENCES
        </span>
        <h2>Set your rhythm.</h2>
        <p>Dates and daily task counts follow your workspace timezone.</p>
        <label className="form-field">
          Timezone
          <select
            value={zone}
            onChange={async (e) => {
              try {
                setProfile(await api.setTimezone(e.target.value));
                setNotice("Timezone saved");
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            {[
              "Asia/Kolkata",
              "Europe/London",
              "America/New_York",
              "America/Los_Angeles",
              "Asia/Singapore",
              "UTC",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <div className="privacy-line">
          <LockKeyhole size={17} />
          <span>
            <strong>{profile.name}</strong>
            <small>{profile.email}</small>
          </span>
        </div>
      </section>
      <section className="settings-card">
        <span className="card-label">
          <Sparkles size={17} /> BUILD CHECKPOINT
        </span>
        <h2>A solid foundation first.</h2>
        <div
          className="ai-provider-settings"
          aria-label="AI provider availability"
        >
          {aiStatus?.providers.map((item) => (
            <div key={item.id}>
              <span>
                {item.label}
                <small>{item.model ? ` · ${item.model}` : ""}</small>
              </span>
              <small>
                {item.ready
                  ? item.external
                    ? "Configured"
                    : "Available"
                  : "Needs configuration"}
              </small>
            </div>
          ))}
        </div>
        <p>
          Credentials stay on the server. Choose a configured provider in the
          assistant and approve external processing for each request. Account
          access and billing availability are checked only when you send.
        </p>
        <p>
          This local build includes tasks, Today, Kanban, calendar, archives and
          immutable activity history.
        </p>
        <div className="build-line">
          <Check size={16} />
          Manual task tracking is ready
        </div>
        <div className="build-line">
          <Clock3 size={16} />
          Provider-backed capture and reviewed updates are available; continuity
          are upcoming
        </div>
        <div className="build-line">
          <Clock3 size={16} />
          Goals, exports, and reminders · upcoming
        </div>
        {!profile.local_identity && (
          <button
            className="secondary-button signout-button"
            onClick={() =>
              void api.signOut(profile.email).catch((e) => setError(e.message))
            }
          >
            Sign out
          </button>
        )}
        <div className="development-note">
          {profile.local_identity
            ? "Development identity · synthetic workspace only. Production sign-in and external beta are not configured."
            : profile.local_environment
              ? "Local Keycloak sign-in. Accounts and verification emails stay on this computer; external beta is not configured."
              : "Identity is verified by the configured provider."}
        </div>
      </section>
    </div>
  );
}
