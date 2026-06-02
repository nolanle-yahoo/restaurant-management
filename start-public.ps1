# start-public.ps1 — publish the Restaurant app to a temporary public URL via Cloudflare.
# Double-click start-public.cmd to run this. Closing the window stops the server + tunnel.

$ErrorActionPreference = 'Stop'
$proj = $PSScriptRoot
$port = 3000
$errLog = Join-Path $proj '_tunnel.err.log'
$outLog = Join-Path $proj '_tunnel.out.log'

function Find-Exe($name, $fallbacks) {
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($f in $fallbacks) { if (Test-Path $f) { return $f } }
  return $null
}

# Locate node and cloudflared.
$node = Find-Exe 'node' @('C:\Program Files\nodejs\node.exe')
if (-not $node) { Write-Host 'ERROR: node.exe not found. Install Node.js first.' -ForegroundColor Red; pause; exit 1 }
$cf = Find-Exe 'cloudflared' @('C:\Program Files (x86)\cloudflared\cloudflared.exe', 'C:\Program Files\cloudflared\cloudflared.exe')
if (-not $cf) { Write-Host 'ERROR: cloudflared not found. Run: winget install Cloudflare.cloudflared' -ForegroundColor Red; pause; exit 1 }

Write-Host 'Stopping any previous server/tunnel...' -ForegroundColor DarkGray
Get-Process node, cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# Start the app server (hidden background process).
Write-Host "Starting app server on http://localhost:$port ..." -ForegroundColor Cyan
$server = Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $proj -WindowStyle Hidden -PassThru

# Wait for the server to answer.
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 750
  try { Invoke-WebRequest -UseBasicParsing "http://localhost:$port/" -TimeoutSec 3 | Out-Null; $ready = $true; break } catch {}
}
if (-not $ready) { Write-Host 'ERROR: server did not start.' -ForegroundColor Red; pause; exit 1 }
Write-Host 'Server is up.' -ForegroundColor Green

# Start the Cloudflare tunnel (http2 transport — more reliable than the default QUIC/UDP).
Remove-Item $errLog, $outLog -ErrorAction SilentlyContinue
Write-Host 'Opening public tunnel...' -ForegroundColor Cyan
$tunnel = Start-Process -FilePath $cf -ArgumentList 'tunnel', '--url', "http://localhost:$port", '--protocol', 'http2' `
  -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog

# Poll the log for the public URL.
$url = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 1000
  if (Test-Path $errLog) {
    $m = Select-String -Path $errLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value; break }
  }
}

if (-not $url) {
  Write-Host 'ERROR: could not get a public URL. See _tunnel.err.log' -ForegroundColor Red
  Get-Process cloudflared, node -ErrorAction SilentlyContinue | Stop-Process -Force
  pause; exit 1
}

# Give the edge a moment to register, then show the link.
Start-Sleep -Seconds 3
Clear-Host
Write-Host ''
Write-Host '  ===================================================================' -ForegroundColor Green
Write-Host '   YOUR SITE IS LIVE — open this link on any device:' -ForegroundColor Green
Write-Host ''
Write-Host "      $url" -ForegroundColor Yellow
Write-Host ''
Write-Host '  ===================================================================' -ForegroundColor Green
Write-Host ''
Write-Host '  Demo logins:' -ForegroundColor Cyan
Write-Host '    Owner    owner@restaurant.com / owner123'
Write-Host '    Manager  manager@downtown.com / mgr123'
Write-Host '    Waiter   waiter@downtown.com  / wait123'
Write-Host '    Customer diner@example.com    / diner123'
Write-Host ''
Write-Host '  Keep this window open. Press Ctrl+C (or close it) to stop sharing.' -ForegroundColor DarkGray
Write-Host ''

# Keep running until the user stops; clean up server + tunnel on exit.
try {
  while ($true) {
    Start-Sleep -Seconds 2
    if ($tunnel.HasExited) { Write-Host 'Tunnel stopped.' -ForegroundColor Red; break }
  }
} finally {
  Write-Host 'Shutting down server and tunnel...' -ForegroundColor DarkGray
  Get-Process cloudflared, node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
