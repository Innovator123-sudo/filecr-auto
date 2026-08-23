# Pushup Pro - one-click local run + FREE Cloudflare quick tunnels (no account needed)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Info($m) { Write-Host "`n[$(Get-Date -Format HH:mm:ss)] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "   $m" -ForegroundColor Green }
function Die($m)  { Write-Host "ERROR: $m" -ForegroundColor Red; Read-Host 'Press Enter to exit'; exit 1 }

# ---- cleanup strays from a previous run --------------------------------------
Get-Process cloudflared -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like "$root*" } | Stop-Process -Force -ErrorAction SilentlyContinue

# Orphaned servers from a previous run would squat ports 5173/3001 and break the
# new tunnels - kill only node processes belonging to THIS folder.
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*filecr-auto*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# ---- 1. prerequisites --------------------------------------------------------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die 'Node.js not found. Install it from https://nodejs.org and re-run.' }

if (-not (Test-Path "$root\server\node_modules")) {
  Info 'First run: installing server dependencies...'
  & npm install --workspace=server 2>&1 | Out-Null
}
if (-not (Test-Path "$root\client\node_modules")) {
  Info 'First run: installing client dependencies (may take a minute)...'
  & npm install --workspace=client 2>&1 | Out-Null
}

# cloudflared: use installed one, else download portable copy into tools\
$cf = Join-Path $root 'tools\cloudflared.exe'
if (-not (Test-Path $cf)) {
  if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
    $cf = (Get-Command cloudflared).Source
  } else {
    Info 'Downloading free Cloudflare tunnel client (~17 MB, one time only)...'
    New-Item -ItemType Directory -Force -Path "$root\tools" | Out-Null
    try {
      Invoke-WebRequest -UseBasicParsing `
        -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' `
        -OutFile $cf
    } catch { Die "Could not download cloudflared: $($_.Exception.Message)" }
    Ok 'Downloaded.'
  }
}

# ---- 2. create the ONE tunnel BEFORE starting services ------------------------
# Vite proxies /api + /socket.io to the local server, so phones only ever need
# this single URL - no baked server URL that goes stale on every restart.
# Vite now runs HTTPS (self-signed) because camera access requires secure
# origins — hence https origin + --no-tls-verify here.
function New-Tunnel([string]$origin, [string]$name) {
  $errLog = Join-Path $env:TEMP "cf_$name.err.log"
  $outLog = Join-Path $env:TEMP "cf_$name.out.log"
  Remove-Item $errLog, $outLog -ErrorAction SilentlyContinue
  $p = Start-Process -FilePath $cf `
      -ArgumentList @('tunnel', '--no-autoupdate', '--no-tls-verify', '--url', $origin) `
      -RedirectStandardError $errLog -RedirectStandardOutput $outLog `
      -PassThru -WindowStyle Hidden
  Info "Creating tunnel for $origin ($name)..."
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 800
    if ($p.HasExited) { break }
    $hit = Select-String -Path $errLog, $outLog -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue |
           Select-Object -First 1
    if ($hit) { return @{ Url = $hit.Matches[0].Value; Proc = $p; ErrLog = $errLog } }
  }
  return @{ Url = $null; Proc = $p; ErrLog = $errLog }
}

$tClient = New-Tunnel 'https://localhost:5173' 'client'
if (-not $tClient.Url) {
  if ($tClient.ErrLog) { Get-Content $tClient.ErrLog -Tail 15 -ErrorAction SilentlyContinue | Write-Host -ForegroundColor Yellow }
  Die 'Cloudflare tunnel failed to start. Check your internet connection and try again.'
}
Ok "App URL: $($tClient.Url)"

# LAN address for devices on the same Wi-Fi (works without the tunnel)
$lanIp = $null
try {
  $lanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Select-Object -First 1).IPAddress
} catch {}

# ---- 3. start backend with CORS open for the tunnel domain -------------------
Info 'Starting game server on :3001 ...'
$env:CLIENT_ORIGIN = "$($tClient.Url),http://localhost:5173"
$srv = Start-Process -FilePath (Get-Command npm.cmd).Source `
     -ArgumentList 'run', 'dev', '--workspace', 'server' `
     -WorkingDirectory $root -WindowStyle Minimized -PassThru

# ---- 4. make sure no stale server URL is baked into the client, then start Vite
Info 'Starting web app on :5173 ...'
Remove-Item "$root\client\.env.local", "$root\client\.env" -ErrorAction SilentlyContinue
$cli = Start-Process -FilePath (Get-Command npm.cmd).Source `
     -ArgumentList 'run', 'dev', '--workspace', 'client', '--', '--strictPort', '--host' `
     -WorkingDirectory $root -WindowStyle Minimized -PassThru

Start-Sleep -Seconds 4

# ---- 5. self-test: the phone URL must serve the app --------------------------
Info 'Verifying phone URL ...'
$phoneOk = $false
try {
  $check = Invoke-WebRequest -Uri $tClient.Url -UseBasicParsing -TimeoutSec 25
  if ($check.StatusCode -eq 200 -and $check.Content -match 'id="root"') { $phoneOk = $true }
} catch {}
if ($phoneOk) { Ok 'Phone URL verified - it serves the web app.' }
else { Write-Host '   WARNING: could not verify yet - give it 10s and refresh. If it still fails, re-run run-tunnel.bat.' -ForegroundColor Yellow }

# ---- 6. show it off ----------------------------------------------------------
$urlTxt = @"
=============================================================

   PUSHUP PRO IS LIVE!

   ON YOUR PHONE, OPEN EXACTLY THIS LINK:

   >>  $($tClient.Url)

   (copied to clipboard - just paste it in the phone browser)
   Music + multiplayer all run through this same link.

   Same Wi-Fi alternative (no tunnel needed - accept the
   certificate warning once: Advanced > Proceed):
$(if ($lanIp) { "   >>  https://$lanIp`:5173" } else { '   >>  (LAN IP not found - use the link above)' })

   On this PC : https://localhost:5173
=============================================================
"@
Clear-Host
Write-Host $urlTxt -ForegroundColor Green
$urls = "OPEN THIS ON YOUR PHONE:`n$($tClient.Url)`n`n(Same Wi-Fi, accept cert warning):`n$(if ($lanIp) { "https://$($lanIp):5173" } else { 'n/a' })`n`n(PC): https://localhost:5173"
Set-Content -Path "$root\pushup-urls.txt" -Value $urls

try { Set-Clipboard -Value $tClient.Url; Ok 'Phone URL copied to clipboard.' } catch {}
try { Start-Process $tClient.Url } catch {}

Write-Host ''
Write-Host 'Keep this window OPEN - closing it shuts everything down.' -ForegroundColor Yellow

# ---- 6. stay alive until user stops, then clean up ---------------------------
try {
  [Console]::ReadKey($true) | Out-Null
} catch {
  while ($true) { Start-Sleep -Seconds 3600 } # window was launched without console input
} finally {
  Info 'Stopping everything...'
  foreach ($p in @($tClient.Proc, $srv, $cli)) {
    if ($p -and -not $p.HasExited) { & taskkill /PID $p.Id /T /F 2>$null | Out-Null }
  }
  Ok 'Stopped. See you at the next workout!'
}
