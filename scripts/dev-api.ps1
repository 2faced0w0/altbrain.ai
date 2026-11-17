$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if ($env:APP_ENV -and $env:APP_ENV -notin @('local', 'test')) {
    throw 'This launcher is for local development only.'
}
$env:APP_ENV = 'local'
$env:LOCAL_IDENTITY = 'true'
if (-not $env:DATABASE_URL) {
    $env:DATABASE_URL = 'postgresql+psycopg://worktracker:local_only@127.0.0.1:55432/worktracker'
}
$env:PYTHONPATH = "$PWD\services\api;$PWD\.local\python-deps"
python -m alembic -c services/api/alembic.ini upgrade head
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed. Check Docker and DATABASE_URL.' }
python scripts/seed_demo_data.py
if ($LASTEXITCODE -ne 0) { throw 'Local fixture seed failed.' }
python -m uvicorn app.main:app --app-dir services/api --host 127.0.0.1 --port 8000
