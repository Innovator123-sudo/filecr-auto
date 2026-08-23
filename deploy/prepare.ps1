# Stages deployable artifacts into this folder:
#   deploy\client\dist   → static web app (upload to any static host)
#   deploy\server\       → compiled API + package.json (npm install && npm start)
# Run from the repo root:  powershell -File deploy\prepare.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

function Info($m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "    $m" -ForegroundColor Green }

Info 'Installing dependencies...'
& npm install --no-audit --no-fund 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

Info 'Building client (tsc + vite build)...'
& npm run build --workspace=client 2>&1 | Select-Object -Last 5
if ($LASTEXITCODE -ne 0) { throw 'client build failed' }

Info 'Building server (tsc)...'
& npm run build --workspace=server 2>&1 | Select-Object -Last 5
if ($LASTEXITCODE -ne 0) { throw 'server build failed' }

$stage = Join-Path $root 'deploy'
Info 'Staging artifacts...'

# client static bundle
$clientOut = Join-Path $stage 'client\dist'
Remove-Item (Join-Path $stage 'client') -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $clientOut | Out-Null
Copy-Item (Join-Path $root 'client\dist\*') $clientOut -Recurse -Force

# server bundle + runtime manifest only (no sources, no dev deps)
$srvOut = Join-Path $stage 'server'
Remove-Item $srvOut -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $srvOut | Out-Null
Copy-Item (Join-Path $root 'server\dist') (Join-Path $srvOut 'dist') -Recurse -Force
Copy-Item (Join-Path $root 'server\package.json') $srvOut -Force
Copy-Item (Join-Path $root 'server\package-lock.json') $srvOut -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $root 'server\.env.example') $srvOut -Force -ErrorAction SilentlyContinue

Ok "Staged: $stage\client\dist  (static site)"
Ok "Staged: $stage\server      (npm install && npm start)"
Write-Host ''
Write-Host 'Deploy tips:' -ForegroundColor Yellow
Write-Host '  ONE service : host server/ and set STATIC_DIR to the client/dist path (see README)'
Write-Host '  Split       : upload client/dist to Vercel/Netlify + server/ to Render'
