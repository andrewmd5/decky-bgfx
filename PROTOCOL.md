# BGFX IPC Protocol

The BGFX Vulkan layer exposes a Unix domain socket for external control. The Decky plugin uses this to read and modify shader presets and parameters while a game is running.

## Connection

Each game process creates a socket at `/tmp/bgfx-overlay-{pid}.sock`. The PID is also written to `/tmp/bgfx-overlay.pid` with `DeleteOnClose` semantics, so it disappears when the process exits.

To connect:

```python
import socket, glob

paths = glob.glob("/tmp/bgfx-overlay-*.sock")
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(paths[0])
```

## Message format

Newline-delimited JSON. Each request is a single JSON object followed by `\n`. Each response is a single JSON object followed by `\n`.

Every response includes `"ok": true` on success or `"ok": false, "error": "message"` on failure.

## Commands

### presets

List all available presets.

```
→ {"cmd":"presets"}
← {"ok":true,"presets":[{"name":"CRT","index":0,"chain_count":2,"is_favorite":false},{"name":"Clean","index":1,"chain_count":1,"is_favorite":true}]}
```

### active

Get the currently active preset with its full effect chain and parameters.

```
→ {"cmd":"active"}
← {"ok":true,"index":0,"name":"CRT","effects":[
     {"name":"CRT_Lottes","scaling":"auto","params":[
       {"name":"hardScan","label":"Hard Scan","type":"float","value":-8.0,"min":-20.0,"max":0.0,"step":0.1,"default":-8.0},
       {"name":"enabled","label":"Enabled","type":"bool","value":1.0,"min":0.0,"max":1.0,"step":1.0,"default":1.0},
       {"name":"lut","label":"LUT","type":"texture","value":"/path/to/lut.png","default":""}
     ]}
   ]}
```

Parameter types:
- `float` / `int` / `bool` have numeric `value`, `min`, `max`, `step`, `default`
- `texture` has string `value` and `default`

Scaling values: `auto`, `integer`, `fit`, `stretch`, `fill`

### activate

Switch to a preset by index.

```
→ {"cmd":"activate","index":1}
← {"ok":true}
```

### set_param

Change a numeric parameter on an effect in the active preset. `effect` is the zero-based index into the effect chain.

```
→ {"cmd":"set_param","effect":0,"name":"hardScan","value":-12.0}
← {"ok":true}
```

Changes apply on the next frame. The parameter name is case-insensitive.

### set_texture

Change a texture parameter.

```
→ {"cmd":"set_texture","effect":0,"name":"lut","value":"/path/to/new_lut.png"}
← {"ok":true}
```

### set_scaling

Change the scaling type for an effect in the chain.

```
→ {"cmd":"set_scaling","effect":0,"value":"integer"}
← {"ok":true}
```

Valid values: `auto`, `integer`, `fit`, `stretch`, `fill`

### save

Persist the current preset's parameters and scaling types to disk.

```
→ {"cmd":"save"}
← {"ok":true}
```

## Errors

All commands return the same error shape:

```json
{"ok":false,"error":"no active preset"}
```

Common errors:
- `not connected` — no socket found
- `no active preset` — no preset is loaded
- `index N out of range` — preset or effect index is invalid
- `parameter 'X' not found` — no parameter with that name on the effect
- `unknown scaling type: X` — invalid scaling value
- `unknown command: X` — unrecognized cmd value

## Testing

You can test the socket directly with socat:

```bash
echo '{"cmd":"presets"}' | socat - UNIX-CONNECT:/tmp/bgfx-overlay-*.sock
echo '{"cmd":"active"}' | socat - UNIX-CONNECT:/tmp/bgfx-overlay-*.sock
echo '{"cmd":"set_param","effect":0,"name":"hardScan","value":-12.0}' | socat - UNIX-CONNECT:/tmp/bgfx-overlay-*.sock
```
