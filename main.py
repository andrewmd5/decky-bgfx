import asyncio
import glob
import json
import os
import re
import time

import decky

PROTOCOL = 2
MAX_RESPONSE_BYTES = 512 * 1024
COMMAND_TIMEOUT = 3.0
DISCOVERY_INTERVAL = 3.0


class Plugin:
    async def _main(self):
        self._lock = asyncio.Lock()
        self._sessions = {}
        self._last_discovery = 0.0
        self._closed = False
        decky.logger.info("BGFX plugin loaded")

    async def _unload(self):
        self._closed = True
        self._sessions.clear()

    async def _uninstall(self):
        await self._unload()

    async def _exchange(self, path: str, request: dict, timeout=COMMAND_TIMEOUT) -> dict:
        async with asyncio.timeout(timeout):
            reader, writer = await asyncio.open_unix_connection(
                path, limit=MAX_RESPONSE_BYTES
            )
            try:
                payload = (json.dumps(request, allow_nan=False) + "\n").encode()
                if len(payload) > 4096:
                    raise ValueError("Control request exceeds the layer's size limit.")
                writer.write(payload)
                await writer.drain()
                line = await reader.readline()
                if not line.endswith(b"\n"):
                    raise OSError("The game closed the connection.")
                result = json.loads(line)
                if not isinstance(result, dict) or not isinstance(result.get("ok"), bool):
                    raise ValueError("Invalid response from the BGFX layer.")
                return result
            finally:
                writer.close()
                await writer.wait_closed()

    async def _discover(self):
        self._last_discovery = time.monotonic()
        candidates = []
        for path in glob.glob("/tmp/bgfx-overlay-*.sock"):
            match = re.fullmatch(r"bgfx-overlay-(\d+)(?:-[0-9a-f]+)?\.sock", os.path.basename(path))
            if match is None or not os.path.isdir(f"/proc/{match[1]}"):
                continue
            try:
                candidates.append((os.stat(path).st_mtime_ns, path))
            except OSError:
                continue
        candidates.sort(reverse=True)
        gate = asyncio.Semaphore(4)

        async def probe(path):
            async with gate:
                try:
                    result = await self._exchange(path, {"cmd": "state"}, timeout=0.75)
                    if result.get("ok") and result.get("protocol") == PROTOCOL:
                        return result["session"], (path, {
                            key: result.get(key) for key in ("session", "pid", "app_id")
                        })
                except (OSError, ValueError, TimeoutError, KeyError):
                    pass
                return None

        results = await asyncio.gather(*(probe(path) for _, path in candidates[:32]))
        self._sessions = dict(result for result in results if result is not None)
        return bool(candidates)

    async def get_state(self, session: str | None = None) -> dict:
        async with self._lock:
            if self._closed:
                return {"ok": False, "error": "Plugin is stopping.", "sessions": []}
            saw_sockets = bool(self._sessions)
            if time.monotonic() - self._last_discovery >= DISCOVERY_INTERVAL:
                saw_sockets = await self._discover()
            sessions = [info for _, info in self._sessions.values()]
            if not self._sessions:
                return {
                    "ok": False, "sessions": [],
                    "error": ("No compatible BGFX session responded. Update Borderless Gaming and restart the game."
                              if saw_sockets else "No BGFX game session detected."),
                }
            if session is None:
                session = next(iter(self._sessions))
            entry = self._sessions.get(session)
            if entry is None:
                return {"ok": False, "sessions": sessions,
                        "error": "This game session ended. Select a running session."}
            try:
                result = await self._exchange(entry[0], {"cmd": "state"})
                if result.get("session") != session or result.get("protocol") != PROTOCOL:
                    raise ValueError("The game session changed. Reopen its controls.")
                result["sessions"] = sessions
                result["stale"] = time.time() * 1000 - result["updated_at"] > 3000
                return result
            except (OSError, ValueError, TimeoutError, KeyError) as error:
                self._sessions.pop(session, None)
                return {"ok": False, "sessions": sessions,
                        "error": str(error) or "The game is not responding."}

    async def command(self, session: str, preset: int, cmd: str,
                      args: dict | None = None) -> dict:
        if cmd not in {"activate", "set_param", "set_texture", "set_scaling", "set_hud", "save"}:
            return {"ok": False, "error": "Unsupported command."}
        async with self._lock:
            entry = self._sessions.get(session)
            if self._closed or entry is None:
                return {"ok": False, "error": "Game session ended. Refresh before editing."}
            request = {**(args or {}), "cmd": cmd, "session": session, "preset": preset}
            try:
                return await self._exchange(entry[0], request)
            except (OSError, ValueError, TimeoutError) as error:
                return {"ok": False, "error": str(error) or
                        "The game did not confirm the change. Resume it and refresh before retrying."}
