# PC se saare server ek saath update:   (pehle git push kar lein)
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-all.ps1            # deploy/servers.txt ke sab
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-all.ps1 gsmmf      # sirf ek
# Har server par chalta hai:  sudo -iu <app> bash <folder>/scripts/deploy.sh
param([string]$Only = "")
$ErrorActionPreference = "Stop"
$list = Join-Path $PSScriptRoot "..\deploy\servers.txt"
if (-not (Test-Path $list)) { Write-Host "deploy\servers.txt nahi mili — deploy\servers.example.txt copy karke banayein" -ForegroundColor Red; exit 1 }
$results = @()
foreach ($line in Get-Content $list) {
  $l = ($line -replace '#.*$', '').Trim()
  if (-not $l) { continue }
  $p = $l -split '\s+'
  $ssh = $p[0]; $app = $p[1]; $dir = if ($p.Count -ge 3) { $p[2] } else { "/opt/$app" }
  if ($Only -and $app -ne $Only) { continue }
  Write-Host "`n=== $app  ($ssh)  ===" -ForegroundColor Cyan
  ssh -o ConnectTimeout=15 -t $ssh "sudo -iu $app bash $dir/scripts/deploy.sh"
  $ok = ($LASTEXITCODE -eq 0)
  $results += [pscustomobject]@{ App = $app; Server = $ssh; Result = $(if ($ok) { "OK" } else { "FAILED" }) }
}
Write-Host ""
$results | Format-Table -AutoSize
if ($results | Where-Object Result -eq "FAILED") { exit 1 }
