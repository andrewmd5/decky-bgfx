$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$name = "BGFX"
$out = Join-Path $root "out"
$pkg = Join-Path $out $name

pnpm --dir $root build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$expected = [IO.Path]::GetFullPath((Join-Path $root "out/BGFX"))
if ([IO.Path]::GetFullPath($pkg) -ne $expected) { throw "Unexpected package directory" }
if (Test-Path -LiteralPath $pkg) { Remove-Item -LiteralPath $pkg -Recurse -Force }
$archive = Join-Path $out "$name.zip"
if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }

New-Item -ItemType Directory -Path (Join-Path $pkg "dist") -Force | Out-Null
Copy-Item (Join-Path $root "dist\index.js") (Join-Path $pkg "dist\index.js")
Copy-Item (Join-Path $root "main.py")       (Join-Path $pkg "main.py")
Copy-Item (Join-Path $root "package.json")  (Join-Path $pkg "package.json")
Copy-Item (Join-Path $root "plugin.json")   (Join-Path $pkg "plugin.json")
Copy-Item (Join-Path $root "LICENSE")       (Join-Path $pkg "LICENSE")
Copy-Item (Join-Path $root "assets\logo.png") (Join-Path $pkg "logo.png")

Compress-Archive -Path $pkg -DestinationPath (Join-Path $out "$name.zip") -Force

Write-Host "Created $out\$name.zip"
