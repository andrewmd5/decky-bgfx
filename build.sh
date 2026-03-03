#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
name="BGFX"
out="$root/out"
pkg="$out/$name"

pnpm --dir "$root" build

rm -rf "$pkg" "$out/$name.zip"
mkdir -p "$pkg/dist"
cp "$root/dist/index.js"    "$pkg/dist/index.js"
cp "$root/main.py"          "$pkg/main.py"
cp "$root/package.json"     "$pkg/package.json"
cp "$root/plugin.json"      "$pkg/plugin.json"
cp "$root/LICENSE"           "$pkg/LICENSE"
cp "$root/assets/logo.png"  "$pkg/logo.png"

cd "$out"
zip -r "$name.zip" "$name"

echo "Created $out/$name.zip"
