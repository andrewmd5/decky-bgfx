import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.modules.setdefault("decky", types.SimpleNamespace(logger=Mock()))
from main import registered_endpoints


class RegistryTests(unittest.TestCase):
    def test_only_current_process_session_in_shared_directory_is_accepted(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary) / "sessions"
            directory.mkdir()
            session = "a" * 32
            endpoint = directory / (session + ".sock")
            endpoint.touch()
            record = directory / "123-session.json"
            value = {"Pid": 123, "ProcessStart": 456, "BootId": "boot", "Session": session,
                     "Endpoint": str(endpoint), "DataDirectory": str(directory.parent), "Path": "application"}
            with patch("main.session_directories", return_value=[str(directory)]), \
                    patch("main.boot_id", return_value="boot"), \
                    patch("main.process_key", return_value="123:456"):
                record.write_text(json.dumps(value))
                entries = registered_endpoints()
                self.assertEqual(len(entries), 1)
                self.assertEqual(entries[0][1:], (str(endpoint), 123, "123:456", session))
                for changed in ({"ProcessStart": 789}, {"BootId": "old"},
                                {"Endpoint": "/unrelated.sock"}, {"Session": "../escape"}):
                    record.write_text(json.dumps({**value, **changed}))
                    self.assertEqual(registered_endpoints(), [])
