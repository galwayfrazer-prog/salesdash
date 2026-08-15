$ErrorActionPreference = "Stop"

$projectRefPath = Join-Path $PSScriptRoot "..\supabase\.temp\project-ref"
if (-not (Test-Path $projectRefPath)) {
  throw "Start local Supabase first with: npx supabase start"
}
$projectRef = (Get-Content -Raw $projectRefPath).Trim()
$container = "supabase_db_$projectRef"
if (-not (docker ps --format "{{.Names}}" | Where-Object { $_ -eq $container })) {
  throw "Local Supabase is not running. Start it with: npx supabase start"
}

# The standalone lockdown migration intentionally expects the legacy kv_store
# fixture to exist. Reset only through the preparatory migrations, then install
# the fixture before exercising the cutover and subsequent migrations.
npx.cmd supabase db reset --local --version 202607200001
if ($LASTEXITCODE -ne 0) { throw "Local Supabase reset failed." }

$fixture = Join-Path $PSScriptRoot "..\supabase\tests\sales_os_auth_fixture.sql"
$preCutover = Join-Path $PSScriptRoot "..\supabase\tests\sales_os_auth_precutover.sql"
$cutover = Join-Path $PSScriptRoot "..\supabase\cutover\202607_sales_os_auth_lockdown.sql"
$postCutover = Join-Path $PSScriptRoot "..\supabase\tests\sales_os_auth_postcutover.sql"
$googleAccess = Join-Path $PSScriptRoot "..\supabase\tests\sales_os_google_access.sql"
$postCutoverMigrations = @(
  "202607220002_precompute_sales_summary.sql",
  "202607220003_add_filip_stojanovic_access.sql",
  "202607220004_remove_long_pipper_badge.sql",
  "202607220005_disable_filip_stojanovic_access.sql",
  "202607220006_exclude_access_only_accounts_from_stats.sql",
  "202607220007_crm_hygiene_cache.sql",
  "202607230001_zoho_deal_notes_cache.sql",
  "202608060001_hit_list_feedback.sql",
  "202608150001_zoho_sales_os_automatic_access.sql"
)

Get-Content -Raw $fixture | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres
if ($LASTEXITCODE -ne 0) { throw "Local Auth fixture failed." }

Get-Content -Raw $preCutover | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres
if ($LASTEXITCODE -ne 0) { throw "The pre-cutover Preview reader exposed unsafe data." }

docker exec $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "update auth.users set email_confirmed_at = null where email = 'rep8@wildvision.io';" *> $null
if ($LASTEXITCODE -ne 0) { throw "Could not create the invalid local account fixture." }

$failedAsExpected = $false
$previousErrorPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
Get-Content -Raw $cutover | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres 2> $null
$cutoverExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorPreference
if ($cutoverExitCode -ne 0) { $failedAsExpected = $true }
if (-not $failedAsExpected) { throw "Cutover should have rejected an unconfirmed linked account." }

$rollbackState = docker exec $container psql -U postgres -d postgres -Atc "select (exists(select 1 from public.kv_store where key like 'invite:%'))::text || '|' || (exists(select 1 from public.kv_store where key like 'user:%' and value::jsonb ? 'passwordHash'))::text;"
if ($rollbackState.Trim() -ne "true|true") { throw "Failed cutover did not roll back safely." }

docker exec $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres -c "update auth.users set email_confirmed_at = now(), last_sign_in_at = now() where email = 'rep8@wildvision.io';" *> $null
if ($LASTEXITCODE -ne 0) { throw "Could not complete the local account fixture." }

Get-Content -Raw $cutover | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres
if ($LASTEXITCODE -ne 0) { throw "Local Auth cutover failed." }

$previousErrorPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
Get-Content -Raw $cutover | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres 2> $null
$repeatCutoverExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorPreference
if ($repeatCutoverExitCode -ne 0) { throw "A safe repeated Auth cutover failed." }

foreach ($migrationName in $postCutoverMigrations) {
  $migration = Join-Path $PSScriptRoot "..\supabase\migrations\$migrationName"
  Get-Content -Raw $migration | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres
  if ($LASTEXITCODE -ne 0) { throw "Post-cutover migration failed: $migrationName" }
}

Get-Content -Raw $googleAccess | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres
if ($LASTEXITCODE -ne 0) { throw "The automatic Google and Zoho access database test failed." }

Get-Content -Raw $postCutover | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d postgres
if ($LASTEXITCODE -ne 0) { throw "Local Auth RLS assertions failed." }

$previousErrorPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
npx.cmd supabase db reset --local --version 202607200001 2> $null
$cleanupExitCode = $LASTEXITCODE
$ErrorActionPreference = $previousErrorPreference
if ($cleanupExitCode -ne 0) { throw "Local Supabase cleanup reset failed." }
