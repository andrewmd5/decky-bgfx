# BGFX IPC v2

Requires Borderless Gaming 1.4.15+. Unix sockets are discovered at
`/tmp/bgfx-overlay-{pid}-{session}.sock`. Each renderer has its own session ID;
the socket is readable/writable only by the game user (and root).

Requests and responses are newline-delimited JSON. Requests are limited to
4096 bytes including the newline. Every response has `ok`; failures include
an `error` string.

## Read state

```json
{"cmd":"state"}
```

Returns one snapshot containing:

- `protocol`, `session`, `pid`, `app_id`, `updated_at` (Unix milliseconds)
- `presets`: index, name, description, favorite flag, chain count
- `active`: preset token/index/name, `show_hud`, effects and parameters
- `requested_preset`: pending preset name, or null
- `status`: state/reason, multiplier, frame rates, failed presents, resolution, compilation progress

States: `compiling`, `error`, `waiting`, `generating`, `active`, `passthrough`.
Frame rates count source arrivals and successful generated/total present submissions,
not display scanout. The timestamp stops advancing if the game stops presenting.

Effects include `can_scale`, `scaling`, and `multiplier_parameter`. Numeric parameters
include value, default, min, max, step, and optional `labels` in step order.
Texture parameters use string value/default fields.

## Change state

Every mutation includes the returned `session` and active `preset` token.
Never replay an edit against a newly discovered session.

```json
{"cmd":"activate","session":"…","preset":1,"index":2}
{"cmd":"set_param","session":"…","preset":1,"effect":0,"name":"factor","value":2}
{"cmd":"set_texture","session":"…","preset":1,"effect":1,"name":"lut","value":"/path/lut.png"}
{"cmd":"set_scaling","session":"…","preset":1,"effect":1,"value":"fit"}
{"cmd":"set_hud","session":"…","preset":1,"value":true}
{"cmd":"save","session":"…","preset":1}
```

Scaling: `auto`, `integer`, `fit`, `stretch`, `fill`.
`set_hud` enables persistent frame-generation FPS; its default is false.

Edits are validated and acknowledged at a source-frame boundary. Activation
acknowledges the request; poll state for preparation or errors. Commands that
expire before execution are discarded. A timeout after execution starts is
indeterminate: refresh before retrying. Save writes an atomic snapshot off the
presentation thread, retaining the shipped filename for user overrides.

The plugin serializes requests, bounds socket waits/responses, and does not
automatically retry writes. A paused game may need to resume before accepting edits.
