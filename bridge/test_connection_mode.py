"""Exercise bridge connection handling without loading its private configuration."""
import ast
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock


FUNCTIONS = {
    "tuya_device", "device_status", "device_set_value", "index_for_code",
    "raw_status", "status_as_result", "send_commands",
}
SOURCE = ast.parse(Path(__file__).with_name("bridge.py").read_text(encoding="utf-8"))
DEFINITIONS = [node for node in SOURCE.body if isinstance(node, ast.FunctionDef) and node.name in FUNCTIONS]


class BridgeConnectionTests(unittest.TestCase):
    def setUp(self):
        self.created = []

        def create(*_args, **_kwargs):
            device = Mock()
            device.status.return_value = {"dps": {"1": True}}
            self.created.append(device)
            return device

        self.entry = {
            "id": "example", "ip": "192.0.2.1", "key": "test-placeholder",
            "version": "3.4", "mapping": {"1": "switch"},
            "mapping_reverse": {"switch": "1"},
        }
        self.ns = {
            "tinytuya": Mock(Device=create), "CONNECTIONS": {}, "STATUS_CACHE": {},
            "STATUS_CACHE_MS": 800, "DEVICE_LOCKS": {"example": threading.RLock()},
            "time": time,
        }
        exec(compile(ast.Module(body=DEFINITIONS, type_ignores=[]), "bridge-functions", "exec"), self.ns)

    def test_canary_closes_existing_persistent_socket_and_uses_fresh_status(self):
        cached = self.ns["tuya_device"](self.entry)
        self.ns["STATUS_CACHE"]["example"] = {"at": time.monotonic() * 1000, "dps": {"1": False}}
        result = self.ns["status_as_result"](self.entry, transient=True)
        self.assertEqual(result, [{"code": "switch", "value": True}])
        cached.close.assert_called_once()
        self.created[-1].close.assert_called_once()
        self.assertNotIn("example", self.ns["CONNECTIONS"])

    def test_canary_does_not_skip_requested_write_or_ignore_tinytuya_error(self):
        def create(*_args, **_kwargs):
            device = Mock()
            device.status.return_value = {"dps": {"1": True}}
            device.set_value.return_value = {"Err": "904", "Error": "Unexpected Payload"}
            self.created.append(device)
            return device

        self.ns["tinytuya"].Device = create
        with self.assertRaisesRegex(RuntimeError, "Tuya refused"):
            self.ns["send_commands"](self.entry, [{"code": "switch", "value": True}], transient=True)
        self.assertEqual(len(self.created), 2)
        self.created[1].set_value.assert_called_once_with("1", True, nowait=False)
        self.assertTrue(all(device.close.call_count == 1 for device in self.created))

    def test_regular_path_still_uses_persistent_connection(self):
        first = self.ns["tuya_device"](self.entry)
        second = self.ns["tuya_device"](self.entry)
        self.assertIs(first, second)
        first.set_socketPersistent.assert_called_once_with(True)
        first.close.assert_not_called()

    def test_direct_write_does_not_use_stale_status_or_skip_equal_cache_value(self):
        self.entry["mapping"] = {"1": "switch_led"}
        self.entry["mapping_reverse"] = {"switch_led": "1"}
        self.ns["STATUS_CACHE"]["example"] = {"at": time.monotonic() * 1000, "dps": {"1": True}}
        result = self.ns["send_commands"](
            self.entry, [{"code": "switch_led", "value": True}], direct=True
        )
        self.assertEqual(result, [])
        self.created[0].set_value.assert_called_once_with("1", True, nowait=False)
        self.created[0].status.assert_not_called()
        self.assertNotIn("example", self.ns["STATUS_CACHE"])

    def test_direct_write_rejects_multiple_values_and_device_error(self):
        self.entry["mapping"] = {"1": "switch_led"}
        self.entry["mapping_reverse"] = {"switch_led": "1"}
        with self.assertRaisesRegex(ValueError, "one lamp"):
            self.ns["send_commands"](self.entry, [{"code": "switch_led", "value": True}] * 2, direct=True)
        self.ns["tinytuya"].Device = lambda *_args, **_kwargs: Mock(set_value=Mock(return_value={"Err": "904"}))
        with self.assertRaisesRegex(RuntimeError, "Tuya refused"):
            self.ns["send_commands"](self.entry, [{"code": "switch_led", "value": True}], direct=True)


if __name__ == "__main__":
    unittest.main()
