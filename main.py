import glob
import json
import os
import socket
import decky


class Plugin:
    _sock: socket.socket | None = None
    _sock_path: str | None = None

    async def _main(self):
        decky.logger.info("BGFX plugin loaded")

    async def _unload(self):
        self._disconnect()
        decky.logger.info("BGFX plugin unloaded")

    async def _uninstall(self):
        self._disconnect()

    async def is_connected(self) -> bool:
        if self._sock is None:
            self._try_connect()
        if self._sock_path and not os.path.exists(self._sock_path):
            self._disconnect()
        return self._sock is not None

    async def get_presets(self) -> dict:
        return self._send({"cmd": "presets"})

    async def get_active(self) -> dict:
        return self._send({"cmd": "active"})

    async def activate_preset(self, index: int) -> dict:
        return self._send({"cmd": "activate", "index": index})

    async def set_param(self, effect: int, name: str, value: float) -> dict:
        return self._send({"cmd": "set_param", "effect": effect, "name": name, "value": value})

    async def set_texture(self, effect: int, name: str, value: str) -> dict:
        return self._send({"cmd": "set_texture", "effect": effect, "name": name, "value": value})

    async def set_scaling(self, effect: int, value: str) -> dict:
        return self._send({"cmd": "set_scaling", "effect": effect, "value": value})

    async def save_preset(self) -> dict:
        return self._send({"cmd": "save"})

    def _send(self, cmd: dict) -> dict:
        if self._sock is None:
            self._try_connect()
        if self._sock is None:
            return {"ok": False, "error": "not connected"}
        try:
            payload = json.dumps(cmd) + "\n"
            self._sock.sendall(payload.encode("utf-8"))
            return self._read_response()
        except (OSError, json.JSONDecodeError) as e:
            decky.logger.warning(f"IPC send failed: {e}")
            self._disconnect()
            return {"ok": False, "error": str(e)}

    def _read_response(self) -> dict:
        buf = b""
        while True:
            chunk = self._sock.recv(4096)
            if not chunk:
                raise OSError("connection closed")
            buf += chunk
            if b"\n" in buf:
                return json.loads(buf[: buf.index(b"\n")])

    def _try_connect(self):
        paths = glob.glob("/tmp/bgfx-overlay-*.sock")
        if not paths:
            return
        paths.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        sock_path = paths[0]
        try:
            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            s.settimeout(2.0)
            s.connect(sock_path)
            self._sock = s
            self._sock_path = sock_path
            decky.logger.info(f"Connected to {sock_path}")
        except OSError as e:
            decky.logger.warning(f"Failed to connect to {sock_path}: {e}")
            self._sock = None

    def _disconnect(self):
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
            self._sock_path = None
