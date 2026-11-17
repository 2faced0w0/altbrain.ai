# ADR 0002: managed identity boundary; provider pending

Proposed production integration; local implementation accepted, 25 October 2026.

Use a managed OIDC provider; final provider, browser authorization-code/PKCE client, MFA and recovery policy require selection before deploying. The API supports RS256 JWT verification against configured HTTPS JWKS, issuer and audience. It requires expiry, issued-at, subject, email and a boolean verified-email claim. Providers whose access tokens omit verified email require a reviewed claim mapping or userinfo boundary. Never relax verification to accommodate an incompatible token.

No production login screen is claimed. The UI reports unavailable production sign-in when local development identity is off. Full OIDC browser redirect/callback and logout/revocation integration are pending; M0's external sign-in gate is therefore not complete.

Local preview is explicitly opt-in with LOCAL_IDENTITY=true and APP_ENV=local. A loopback-only POST with a custom header and origin check issues an in-memory random session token for a single server-selected synthetic subject. The browser cannot choose a subject/email/workspace. Restarting the API invalidates it. Production/test application fixtures use signed RSA JWTs to verify authentication and tenant isolation, without trusting a selected user ID.

APP_ENV outside local/test rejects local identity, missing OIDC configuration, non-HTTPS JWKS, and non-PostgreSQL databases at startup. Production launch must set APP_ENV=production explicitly and must use restricted database roles. The Compose database role is local-only and is not a production permission design. RLS and production non-superuser migrations/traffic roles remain beta hardening work.

Invitation redemption hashes the token, checks verified identity/email, expiry and unused state, then conditionally consumes it and creates user/owner membership/workspace in one transaction. Operational invite issuance, redemption throttles, security review and real identity-provider UAT remain pending.


Update, 26 October 2026: the local Keycloak browser/session/invitation flow is implemented and verified; see ADR 0008. The earlier statements that no production-capable browser flow exists are historical. External deployment, operational hardening and global revocation remain gated.
