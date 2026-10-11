$ErrorActionPreference = 'Stop'
$tvRoot = $env:MYTV_LAUNCH_ROOT
if (-not $tvRoot) { $tvRoot = (Get-Location).Path }
$tvTokens = $null
$tvErrors = $null
$tvAst = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $tvRoot 'scripts/bootstrap-windows.ps1'), [ref]$tvTokens, [ref]$tvErrors)
if ($tvErrors.Count -gt 0) { throw ($tvErrors | Out-String) }
$tvFunction = $tvAst.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-TvNode' }, $true)
. ([ScriptBlock]::Create($tvFunction.Extent.Text))
# Legacy argument passing matches Windows PowerShell 5.1 when tested from PowerShell 7.
$PSNativeCommandArgumentPassing = 'Legacy'
$tvNode = $env:MYTV_TEST_NODE
if (-not $tvNode) { $tvNode = (Get-Command node -CommandType Application).Source }
if (-not (Test-TvNode $tvNode)) { throw 'Existing Node + npm was not detected.' }
if (Test-TvNode (Join-Path $tvRoot 'missing-node.exe')) { throw 'Missing Node was incorrectly accepted.' }
Write-Output 'Windows launcher syntax and Node detection passed.'
