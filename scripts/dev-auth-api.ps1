$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
python scripts/init_local_auth.py
if ($LASTEXITCODE -ne 0) { throw 'Local identity configuration failed.' }
$authConfig = Get-Content -LiteralPath .local/auth/config.json -Raw | ConvertFrom-Json
$env:APP_ENV = 'local'
$env:LOCAL_IDENTITY = 'false'
if (Test-Path -LiteralPath "$PWD\.local\ai\config.json") { $env:WORKROOM_AI_CONFIG = "$PWD\.local\ai\config.json" }
if (Test-Path -LiteralPath "$PWD\.env") { $env:WORKROOM_AI_ENV = "$PWD\.env" }

$env:WORKROOM_ORIGIN = 'http://127.0.0.1:5173'
$env:OIDC_ISSUER = 'http://127.0.0.1:8088/realms/workroom'
$env:OIDC_AUDIENCE = 'workroom-api'
$env:OIDC_JWKS_URL = "$env:OIDC_ISSUER/protocol/openid-connect/certs"
$env:OIDC_CLIENT_ID = 'workroom-web'
$env:OIDC_CLIENT_SECRET = $authConfig.client_secret
if (-not $env:DATABASE_URL) { $env:DATABASE_URL = 'postgresql+psycopg://worktracker:local_only@127.0.0.1:55432/worktracker' }
$env:PYTHONPATH = "$PWD\services\api;$PWD\.local\python-deps"
python -m alembic -c services/api/alembic.ini upgrade head
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
python -m uvicorn app.main:app --app-dir services/api --host 127.0.0.1 --port 8000 --no-proxy-headers
