# Start portable Redis for Windows (SETUP.md Step 1e fallback)
$redisDir = Join-Path (Join-Path $PSScriptRoot "..") ".redis-local"
$redisExe = Join-Path $redisDir "redis-server.exe"

if (-not (Test-Path $redisExe)) {
    Write-Host "Downloading Redis for Windows..."
    New-Item -ItemType Directory -Force -Path $redisDir | Out-Null
    $zip = Join-Path $env:TEMP "redis-win.zip"
    Invoke-WebRequest -Uri "https://github.com/tporadowski/redis/releases/download/v5.0.14.1/Redis-x64-5.0.14.1.zip" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $redisDir -Force
}

$existing = Get-Process redis-server -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Redis already running (PID $($existing.Id))"
    exit 0
}

Start-Process -FilePath $redisExe -ArgumentList "--port 6379" -WindowStyle Hidden
Start-Sleep -Seconds 2

try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect("127.0.0.1", 6379)
    $c.Close()
    Write-Host "Redis started on port 6379"
} catch {
    Write-Error "Redis failed to start"
    exit 1
}
