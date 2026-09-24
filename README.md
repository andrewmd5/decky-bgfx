# BGFX for Decky

Control Borderless Gaming effects from Steam Deck's Quick Access Menu.

Requires **Borderless Gaming 1.4.15+** and Decky Loader. Enable the game's BGFX profile in Holo and restart the game first.

- Live source/generated FPS and layer status
- Preset selection and inline controls for every effect
- Labeled BGFG multiplier and quality settings
- Split comparison and optional persistent FPS
- Save presets and copy session diagnostics

## Install

Download `BGFX.zip` from [Releases](https://github.com/andrewmd5/decky-bgfx/releases/latest), then install it through Decky's **Install Plugin from ZIP** option.

## Build

Node.js 22 and pnpm 10.30.3:

```sh
pnpm install --frozen-lockfile
pnpm check
bash build.sh
```

On Windows, use `./build.ps1` instead. Both produce `out/BGFX.zip`.

## Release

CI checks and packages every push to main and every pull request. To publish:

1. Update `package.json`'s version on main.
2. Commit and push.
3. Push the matching `vX.Y.Z` tag.

The tag workflow checks the version and main ancestry, builds the archive, and publishes a GitHub release with `BGFX.zip` and `SHA256SUMS`.

## License

BSD-3-Clause.
