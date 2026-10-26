# Destructive QA reset: removes generated dependencies, .env, local demo data,
# build outputs and audit scratch files. Run only in this expendable demo checkout.
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $taskRoot
$records = [Collections.Generic.List[object]]::new()
function Save-Result([string]$State) {
  @{ status=$State; node=(& node --version); checks=$records.ToArray() } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskRoot 'docs/AUDIT-FINAL.json')
}
function Invoke-NpmCheck([string]$Name, [string[]]$CommandArguments) {
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $log = Join-Path $taskRoot ".audit/final/$Name.log"
  & npm.cmd @CommandArguments *> $log
  $code = $LASTEXITCODE
  $records.Add(@{ name=$Name; command=('npm ' + ($CommandArguments -join ' ')); exitCode=$code; seconds=[Math]::Round($watch.Elapsed.TotalSeconds, 2) })
  Save-Result 'running'
  if ($code -ne 0) { Get-Content -LiteralPath $log -Tail 45; throw "$Name failed (exit $code)" }
  Write-Output "PASS npm $($CommandArguments -join ' ') (exit 0)"
}
try {
  $relativeTargets = @('node_modules','apps/web/node_modules','apps/api/node_modules','packages/sdk-js/node_modules','packages/sdk-node/node_modules','apps/web/.next','packages/sdk-js/dist','packages/sdk-node/dist','.env','analytics.sqlite','analytics.sqlite-shm','analytics.sqlite-wal','apps/api/analytics.sqlite','apps/api/analytics.sqlite-shm','apps/api/analytics.sqlite-wal','apps/web/tsconfig.tsbuildinfo','apps/web/next-env.d.ts','.audit')
  $targets = foreach ($relative in $relativeTargets) {
    $absolute = [IO.Path]::GetFullPath((Join-Path $taskRoot $relative))
    if (!$absolute.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Cleanup escaped workspace' }
    $absolute
  }
  # All resolved absolute targets have been checked before any recursive delete.
  foreach ($absolute in $targets) { if (Test-Path -LiteralPath $absolute) { Remove-Item -LiteralPath $absolute -Recurse -Force } }
  New-Item -ItemType Directory -Path (Join-Path $taskRoot '.audit/final') -Force | Out-Null
  $records.Add(@{ name='clean'; command='Remove verified generated targets; preserve tracked sources/Git'; exitCode=0 })
  Save-Result 'running'
  Invoke-NpmCheck 'install' @('ci')
  Copy-Item -LiteralPath (Join-Path $taskRoot '.env.example') -Destination (Join-Path $taskRoot '.env')
  $records.Add(@{ name='environment'; command='Copy-Item .env.example .env'; exitCode=0 })
  Invoke-NpmCheck 'migrate' @('run','migrate')
  Invoke-NpmCheck 'seed' @('run','seed:demo')
  Invoke-NpmCheck 'build' @('run','build')
  Invoke-NpmCheck 'typecheck' @('run','typecheck')
  Invoke-NpmCheck 'unit-before-mutations' @('run','test:report')
  $mutationPaths = @('apps/api/src/migrations/001_initial.ts','apps/api/src/ingestion.ts','apps/api/src/app.ts','apps/api/src/stats.ts','apps/api/src/restaurant.ts','packages/sdk-js/src/index.ts')
  $hashes = @{}; foreach ($path in $mutationPaths) { $hashes[$path]=(Get-FileHash -LiteralPath $path).Hash }
  Invoke-NpmCheck 'mutations' @('run','test:mutations')
  foreach ($path in $mutationPaths) { if ((Get-FileHash -LiteralPath $path).Hash -ne $hashes[$path]) { throw "Mutation failed to restore $path" } }
  Invoke-NpmCheck 'unit-after-mutations' @('run','test:report')
  Invoke-NpmCheck 'package-contracts' @('run','test:packages')
  Invoke-NpmCheck 'e2e' @('run','test:e2e')
  Invoke-NpmCheck 'failure-e2e' @('run','test:failures')
  Invoke-NpmCheck 'docs-e2e' @('run','test:docs')
  Invoke-NpmCheck 'browser' @('run','test:ui')
  Invoke-NpmCheck 'query-plans' @('run','explain')
  Invoke-NpmCheck 'postgres-fixture' @('install','--prefix','.audit/postgres-runtime','--no-save','--package-lock=false','--ignore-scripts','@embedded-postgres/windows-x64@18.4.0-beta.17')
  Invoke-NpmCheck 'postgres' @('run','test:postgres:local')
  Invoke-NpmCheck 'bundle-size' @('run','size')
  Invoke-NpmCheck 'dependency-audit' @('audit')
  Save-Result 'passed'
  Write-Output 'CLEAN VERIFICATION PASSED. See docs/AUDIT-FINAL.json and .audit/final/*.log.'
} catch { Save-Result 'failed'; throw }
