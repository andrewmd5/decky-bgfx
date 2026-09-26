import asyncio
import glob
import json
import os
import re
import time
from dataclasses import dataclass

import decky

PROTOCOL = 2
MAX_RESPONSE_BYTES = 512 * 1024
COMMAND_TIMEOUT = 3.0
DISCOVERY_INTERVAL = 3.0
SNAPSHOT_MAX_AGE_MS = 3000


def process_key(pid: int) -> str | None:
    try:
        with open(f"/proc/{pid}/stat") as stat:
            fields = stat.read().rpartition(")")[2].split()
        return f"{pid}:{fields[19]}"
    except (OSError, IndexError):
        return None


@dataclass
class Endpoint:
    path: str
    game: str
    state: dict
    reachable: bool = True

    @property
    def session(self):
        return self.state["session"]

    def info(self):
        return {"game": self.game, **{
            key: self.state.get(key) for key in ("session", "pid", "app_id")
        }}

    def rank(self, preferred=False):
        fresh = time.time() * 1000 - self.state["updated_at"] <= SNAPSHOT_MAX_AGE_MS
        presented = self.state.get("presentation", {}).get("has_presented", False)
        return self.reachable, fresh and presented, presented, fresh, preferred


class Plugin:
    async def _main(self):
        self._lock = asyncio.Lock()
        self._endpoints = {}
        self._games = {}
        self._last_discovery = 0.0
        self._closed = False
        decky.logger.info("BGFX plugin loaded")

    async def _unload(self):
        self._closed = True
        self._endpoints.clear()
        self._games.clear()

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
            if match is None:
                continue
            pid = int(match[1])
            game = process_key(pid)
            if game is None:
                continue
            try:
                candidates.append((os.stat(path).st_mtime_ns, path, pid, game))
            except OSError:
                continue
        candidates.sort(reverse=True)
        gate = asyncio.Semaphore(4)

        previous = {entry.path: entry for entry in self._endpoints.values()}

        async def probe(path, pid, game):
            async with gate:
                try:
                    result = await self._exchange(path, {"cmd": "state"}, timeout=0.75)
                    if (result.get("ok") and result.get("protocol") == PROTOCOL
                            and result.get("pid") == pid and isinstance(result.get("session"), str)
                            and isinstance(result.get("updated_at"), (int, float))
                            and process_key(pid) == game):
                        return Endpoint(path, game, result)
                except (OSError, ValueError, TimeoutError, KeyError):
                    pass
                cached = previous.get(path)
                if cached and cached.game == game and os.path.exists(path):
                    cached.reachable = False
                    return cached
                return None

        results = await asyncio.gather(*(probe(path, pid, game) for _, path, pid, game in candidates[:32]))
        self._endpoints = {entry.session: entry for entry in results if entry is not None}
        games = {}
        for entry in self._endpoints.values():
            current = games.get(entry.game)
            preferred = self._games.get(entry.game)
            if current is None or entry.rank(entry.session == preferred) > current.rank(current.session == preferred):
                games[entry.game] = entry
        self._games = {game: entry.session for game, entry in games.items()}
        return bool(candidates)

    def _session_list(self):
        return [self._endpoints[session].info() for session in self._games.values()]

    def _select(self, game):
        if game in self._games:
            return self._endpoints[self._games[game]]
        if game:
            pid = game.partition(":")[0]
            if pid.isdecimal() and process_key(int(pid)) == game:
                return None
        return next((self._endpoints[session] for session in self._games.values()), None)

    async def get_state(self, game: str | None = None) -> dict:
        async with self._lock:
            if self._closed:
                return {"ok": False, "error": "Plugin is stopping.", "sessions": []}
            if time.monotonic() - self._last_discovery >= DISCOVERY_INTERVAL:
                await self._discover()
            for attempt in range(2):
                entry = self._select(game)
                if entry is not None:
                    game = entry.game
                    try:
                        result = await self._exchange(entry.path, {"cmd": "state"})
                        if (not result.get("ok") or result.get("session") != entry.session
                                or result.get("protocol") != PROTOCOL
                                or process_key(result["pid"]) != game):
                            raise ValueError("Session changed")
                        entry.state = result
                        entry.reachable = True
                        return {**result, "game": game, "sessions": self._session_list(),
                                "stale": time.time() * 1000 - result["updated_at"] > SNAPSHOT_MAX_AGE_MS}
                    except (OSError, ValueError, TimeoutError, KeyError):
                        entry.reachable = False
                if attempt == 0:
                    await self._discover()
            pid = game.partition(":")[0] if game else ""
            reconnecting = bool(pid.isdecimal() and process_key(int(pid)) == game)
            return {"ok": False, "sessions": self._session_list(), "reconnecting": reconnecting,
                    "error": "Reconnecting…" if reconnecting else "No BGFX game session detected."}

    async def command(self, session: str, preset: int, cmd: str,
                      args: dict | None = None) -> dict:
        if cmd not in {"activate", "set_param", "set_texture", "set_scaling", "set_hud", "save"}:
            return {"ok": False, "error": "Unsupported command."}
        async with self._lock:
            entry = self._endpoints.get(session)
            if self._closed or entry is None:
                return {"ok": False, "error": "Game session ended. Refresh before editing."}
            if self._games.get(entry.game) != session or process_key(entry.state["pid"]) != entry.game:
                return {"ok": False, "error": "The game changed its renderer. Try the control again."}
            request = {**(args or {}), "cmd": cmd, "session": session, "preset": preset}
            try:
                return await self._exchange(entry.path, request)
            except (OSError, ValueError, TimeoutError) as error:
                return {"ok": False, "error": str(error) or
                        "The game did not confirm the change. Resume it and refresh before retrying."}
