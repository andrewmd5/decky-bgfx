import os
import sys
import time
import types
import unittest
from unittest.mock import AsyncMock, Mock, patch

sys.modules.setdefault("decky", types.SimpleNamespace(logger=Mock()))

from main import Plugin, PROTOCOL


class DiscoveryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.plugin = Plugin()
        await self.plugin._main()
        self.path = "/tmp/bgfx-overlay-123-abcdef.sock"
        self.state = {
            "ok": True,
            "protocol": 4,
            "pid": 123,
            "session": "abcdef",
            "updated_at": time.time() * 1000,
            "presentation": {"path": "application", "has_presented": True},
            "status": {"state": "generating", "generated_fps": 30},
        }
        self.plugin._exchange = AsyncMock(side_effect=lambda *args, **kwargs: dict(self.state))
        for mock in (
            patch("main.registered_endpoints", return_value=[]),
            patch("main.glob.glob", return_value=[self.path]),
            patch("main.process_key", return_value="123:456"),
            patch("main.os", types.SimpleNamespace(
                stat=Mock(return_value=types.SimpleNamespace(st_mtime_ns=1)),
                path=types.SimpleNamespace(basename=os.path.basename, realpath=os.path.realpath, exists=Mock(return_value=True)),
            )),
        ):
            mock.start()
            self.addCleanup(mock.stop)

    async def test_advertised_endpoint_works_without_tmp_socket(self):
        with patch("main.registered_endpoints", return_value=[(1, "/shared/session.sock", 123, "123:456", "abcdef")]), \
                patch("main.glob.glob", return_value=[]):
            result = await self.plugin.get_state()
        self.assertTrue(result["ok"])
        self.assertEqual(self.plugin._select(None).path, "/shared/session.sock")

    async def test_registry_identity_mismatch_is_rejected(self):
        with patch("main.registered_endpoints", return_value=[(1, "/shared/session.sock", 123, "123:456", "replacement")]), \
                patch("main.glob.glob", return_value=[]):
            result = await self.plugin.get_state()
        self.assertFalse(result["ok"])

    async def test_presenting_replacement_beats_retired_effect_pipeline(self):
        now = time.time() * 1000
        old = self.renderer(123, "application", status={"effects_active": True},
            presentation={"path": "application", "has_presented": True,
                          "last_effect_presented_at": now - 10000, "last_presented_at": now - 10000})
        new = self.renderer(123, "application", session="abcdef01", status={"effects_active": False},
            presentation={"path": "application", "has_presented": True,
                          "last_effect_presented_at": 0, "last_presented_at": now})
        await self.discover_sessions(old, new)
        self.assertEqual(self.plugin._select("app:19680").session, "abcdef01")

    async def test_current_runtime_is_discovered(self):
        self.assertEqual(PROTOCOL, 4)
        result = await self.plugin.get_state()
        self.assertTrue(result["ok"])
        self.assertEqual(result["session"], "abcdef")
        self.assertEqual(result["status"]["generated_fps"], 30)

    async def test_incompatible_runtime_reports_version(self):
        self.state["protocol"] = 2
        result = await self.plugin.get_state()
        self.assertFalse(result["ok"])
        self.assertIn("protocol 2", result["error"])
        self.assertIn("requires protocol 4", result["error"])
        self.assertFalse(result["reconnecting"])

    async def test_protocol_change_removes_cached_endpoint(self):
        await self.plugin.get_state()
        self.state["protocol"] = 5
        result = await self.plugin.get_state("123:456")
        self.assertFalse(result["ok"])
        self.assertEqual(result["sessions"], [])
        self.assertIn("protocol 5", result["error"])

    async def test_ended_incompatible_session_clears_diagnostic(self):
        self.state["protocol"] = 2
        await self.plugin.get_state()
        with patch("main.glob.glob", return_value=[]):
            result = await self.plugin.get_state()
        self.assertEqual(result["error"], "No BGFX game session detected.")

    async def test_discovery_recovers_after_runtime_update(self):
        self.state["protocol"] = 2
        await self.plugin.get_state()
        self.state["protocol"] = 4
        result = await self.plugin.get_state()
        self.assertTrue(result["ok"])

    async def discover_sessions(self, *states):
        paths = {f"/tmp/bgfx-overlay-{state['pid']}-{state['session']}.sock": state for state in states}
        self.plugin._exchange = AsyncMock(side_effect=lambda path, *args, **kwargs: dict(paths[path]))
        with patch("main.glob.glob", return_value=list(paths)), \
                patch("main.process_key", side_effect=lambda pid: f"{pid}:456"):
            await self.plugin._discover()

    def renderer(self, pid, route, app="19680", **changes):
        return {**self.state, "pid": pid, "session": f"{pid:06x}", "app_id": app,
                "presentation": {"path": route, "has_presented": True}, **changes}

    async def test_capture_and_application_are_one_game(self):
        await self.discover_sessions(self.renderer(123, "capture"), self.renderer(124, "application"))
        sessions = self.plugin._session_list()
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]["game"], "app:19680")
        self.assertEqual(sessions[0]["pid"], 124)

    async def test_active_capture_beats_stale_application(self):
        await self.discover_sessions(self.renderer(123, "capture"),
                                     self.renderer(124, "application", updated_at=1))
        self.assertEqual(self.plugin._select("app:19680").state["pid"], 123)

    async def test_stale_discovery_refreshes_the_snapshot_requested_at_the_render_boundary(self):
        stale = {**self.state, "updated_at": time.time() * 1000 - 10000}
        responses = iter([stale, self.state, self.state])
        self.plugin._exchange = AsyncMock(side_effect=lambda *args, **kwargs: dict(next(responses)))
        result = await self.plugin.get_state()
        self.assertFalse(result["stale"])
        self.assertEqual(result["updated_at"], self.state["updated_at"])

    async def test_title_screen_renderer_does_not_hide_the_newer_game_renderer(self):
        old = self.renderer(123, "application", updated_at=time.time() * 1000 - 60000)
        new = self.renderer(123, "application", session="abcdef01", updated_at=time.time() * 1000 - 4000)
        self.plugin._games["app:19680"] = old["session"]
        await self.discover_sessions(old, new)
        self.assertEqual(self.plugin._select("app:19680").session, "abcdef01")

    async def test_recent_capture_beats_an_older_direct_renderer_when_both_snapshots_are_stale(self):
        await self.discover_sessions(
            self.renderer(123, "application", updated_at=time.time() * 1000 - 60000),
            self.renderer(124, "capture", updated_at=time.time() * 1000 - 4000))
        self.assertEqual(self.plugin._select("app:19680").state["pid"], 124)

    async def test_fresh_renderers_do_not_switch_due_to_small_snapshot_timing_differences(self):
        old = self.renderer(123, "application")
        new = self.renderer(123, "application", session="abcdef01", updated_at=time.time() * 1000 + 1)
        self.plugin._games["app:19680"] = old["session"]
        await self.discover_sessions(old, new)
        self.assertEqual(self.plugin._select("app:19680").session, old["session"])

    async def test_stopped_renderer_remains_stale_after_refresh(self):
        self.state["updated_at"] = time.time() * 1000 - 60000
        result = await self.plugin.get_state()
        self.assertTrue(result["ok"])
        self.assertTrue(result["stale"])

    async def test_separate_steam_games_remain_selectable(self):
        await self.discover_sessions(self.renderer(123, "application"),
                                     self.renderer(124, "application", app="730"))
        self.assertEqual(len(self.plugin._session_list()), 2)
        self.assertEqual(self.plugin._select("app:730").state["pid"], 124)
        self.assertIsNone(self.plugin._select("app:999"))

    async def test_non_steam_processes_do_not_collapse(self):
        await self.discover_sessions(self.renderer(123, "application", app=""),
                                     self.renderer(124, "application", app="0"))
        self.assertEqual(len(self.plugin._session_list()), 2)

    async def test_old_renderer_cannot_receive_edits_after_handoff(self):
        await self.discover_sessions(self.renderer(123, "capture"), self.renderer(124, "application"))
        result = await self.plugin.command("00007b", 1, "set_param")
        self.assertFalse(result["ok"])
        self.assertIn("changed its renderer", result["error"])

    async def test_app_identity_does_not_replace_process_validation(self):
        self.state.update(self.renderer(123, "application"))
        result = await self.plugin.get_state()
        self.assertTrue(result["ok"])
        self.assertEqual(result["game"], "app:19680")
        result = await self.plugin.command(result["session"], 1, "set_param")
        self.assertTrue(result["ok"])
        with patch("main.process_key", return_value="123:999"):
            result = await self.plugin.command(self.state["session"], 1, "save")
        self.assertFalse(result["ok"])

    async def test_stale_protocol_timestamp_is_rejected(self):
        self.state["updated_at"] = float("nan")
        result = await self.plugin.get_state()
        self.assertFalse(result["ok"])

    async def test_malformed_presentation_is_rejected_without_crashing(self):
        self.state["presentation"] = None
        result = await self.plugin.get_state()
        self.assertFalse(result["ok"])

    async def test_invalid_snapshot_removes_previous_cached_session(self):
        await self.plugin.get_state()
        self.state["updated_at"] = "invalid"
        result = await self.plugin.get_state()
        self.assertFalse(result["ok"])
        self.assertEqual(result["sessions"], [])


if __name__ == "__main__":
    unittest.main()
