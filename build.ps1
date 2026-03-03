$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$name = "BGFX"
$out = Join-Path $root "out"
$pkg = Join-Path $out $name

pnpm --dir $root build

Remove-Item -Recurse -Force $pkg -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path $out "$name.zip") -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Path (Join-Path $pkg "dist") -Force | Out-Null
Copy-Item (Join-Path $root "dist\index.js") (Join-Path $pkg "dist\index.js")
Copy-Item (Join-Path $root "main.py")       (Join-Path $pkg "main.py")
Copy-Item (Join-Path $root "package.json")  (Join-Path $pkg "package.json")
Copy-Item (Join-Path $root "plugin.json")   (Join-Path $pkg "plugin.json")
Copy-Item (Join-Path $root "LICENSE")       (Join-Path $pkg "LICENSE")
Copy-Item (Join-Path $root "assets\logo.png") (Join-Path $pkg "logo.png")

Compress-Archive -Path $pkg -DestinationPath (Join-Path $out "$name.zip") -Force

Write-Host "Created $out\$name.zip"
