# BGFX - Decky Loader Plugin

Control [Borderless Gaming](https://store.steampowered.com/app/388080/Borderless_Gaming/) shader effects from the Steam Deck Quick Access Menu.

Requires **Borderless Gaming v1.4.3** or higher with the BGFX Vulkan layer active.

## Features

- Select and switch presets
- Adjust effect parameters in real time
- Change per-effect scaling type
- Save preset changes

## Requirements

- [Decky Loader](https://decky.xyz/) installed on your Steam Deck
- Node.js v16.14+ and pnpm v9+ for building from source

## Building

```bash
pnpm install
pnpm build
```

## Install on Steam Deck

### From zip

1. Build the plugin
2. Create the zip:
   ```bash
   mkdir -p out/BGFX/dist
   cp dist/index.js out/BGFX/dist/
   cp main.py package.json plugin.json out/BGFX/
   cd out && zip -r BGFX.zip BGFX/
   ```
3. Transfer `BGFX.zip` to your Steam Deck
4. Install via Decky Loader > Settings > Developer > Install Plugin From ZIP

### Manual

1. Copy the `BGFX/` folder to `~/homebrew/plugins/` on your Steam Deck
2. Restart Decky Loader

## Usage

1. Launch a game with the BGFX Vulkan layer enabled
2. Open the Quick Access Menu
3. Navigate to the BGFX plugin tab
4. Select a preset from the dropdown
5. Tap an effect to open its settings
6. Tap "Save Preset" to persist changes

## License

BSD-3-Clause
