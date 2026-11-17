"""Generate local-only provider config once. Never print credentials."""

import json
import secrets
from pathlib import Path

root = Path(__file__).resolve().parents[1]
folder = root / ".local/auth"
folder.mkdir(parents=True, exist_ok=True)
config_path = folder / "config.json"
if not config_path.exists():
    config_path.write_text(
        json.dumps(
            {
                "admin_username": "workroom-admin",
                "admin_password": secrets.token_urlsafe(30),
                "client_secret": secrets.token_urlsafe(36),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
config = json.loads(config_path.read_text(encoding="utf-8"))
(folder / "keycloak.env").write_text(
    "KC_BOOTSTRAP_ADMIN_USERNAME="
    + config["admin_username"]
    + "\nKC_BOOTSTRAP_ADMIN_PASSWORD="
    + config["admin_password"]
    + "\n",
    encoding="utf-8",
)
imports = folder / "import"
imports.mkdir(exist_ok=True)
realm = {
    "realm": "workroom",
    "enabled": True,
    "displayName": "Workroom",
    "sslRequired": "none",
    "registrationAllowed": True,
    "registrationEmailAsUsername": True,
    "loginWithEmailAllowed": True,
    "duplicateEmailsAllowed": False,
    "verifyEmail": True,
    "resetPasswordAllowed": True,
    "editUsernameAllowed": False,
    "bruteForceProtected": True,
    "failureFactor": 5,
    "accessTokenLifespan": 900,
    "ssoSessionIdleTimeout": 1800,
    "ssoSessionMaxLifespan": 28800,
    "passwordPolicy": "length(12) and digits(1) and lowerCase(1) and upperCase(1)",
    "smtpServer": {
        "host": "mailpit",
        "port": "1025",
        "from": "signin@workroom.test",
        "fromDisplayName": "Workroom local sign-in",
        "ssl": "false",
        "starttls": "false",
        "auth": "false",
    },
    "clients": [
        {
            "clientId": "workroom-web",
            "name": "Workroom",
            "enabled": True,
            "protocol": "openid-connect",
            "publicClient": False,
            "secret": config["client_secret"],
            "standardFlowEnabled": True,
            "directAccessGrantsEnabled": False,
            "serviceAccountsEnabled": False,
            "redirectUris": ["http://127.0.0.1:5173/api/v1/auth/callback"],
            "webOrigins": ["http://127.0.0.1:5173"],
            "attributes": {
                "pkce.code.challenge.method": "S256",
                "post.logout.redirect.uris": "http://127.0.0.1:5173/app/today?logged_out=1",
            },
            "defaultClientScopes": ["web-origins", "profile", "email", "roles"],
            "protocolMappers": [
                {
                    "name": "workroom-api-audience",
                    "protocol": "openid-connect",
                    "protocolMapper": "oidc-audience-mapper",
                    "consentRequired": False,
                    "config": {
                        "included.custom.audience": "workroom-api",
                        "id.token.claim": "false",
                        "access.token.claim": "true",
                    },
                }
            ],
        }
    ],
}
realm_path = imports / "workroom-realm.json"
if not realm_path.exists():
    realm_path.write_text(json.dumps(realm, indent=2), encoding="utf-8")
print(
    "Local auth configuration ready. Credentials stay in .local/auth/config.json (ignored)."
)
