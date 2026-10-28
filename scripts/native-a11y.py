"""Exercise only the disposable GitPop process whose PID is passed by native-smoke.mjs."""
import sys
import time
import gi
from pathlib import Path

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi

process_id = int(sys.argv[1])


def application():
    desktop = Atspi.get_desktop(0)
    for index in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(index)
        if app.get_process_id() == process_id:
            return app
    return None


def descendants(node, depth=0):
    if node is None or depth > 24:
        return
    yield node
    for index in range(min(node.get_child_count(), 200)):
        child = node.get_child_at_index(index)
        if child is not None:
            yield from descendants(child, depth + 1)


def wait_for(predicate, description):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        try:
            for node in descendants(application()):
                if predicate(node):
                    return node
        except Exception:
            pass
        time.sleep(0.15)
    raise RuntimeError("Native accessibility check failed: " + description)


def named(name):
    return wait_for(lambda node: node.get_name() == name, name)


def text(node):
    value = node.get_name()
    interface = node.get_text_iface()
    if interface is not None:
        value += Atspi.Text.get_text(interface, 0, min(Atspi.Text.get_character_count(interface), 10000))
    return value


named("Open repository")
named("sample repository")
checkbox = named("Include sample.txt")
if not checkbox.get_action_iface().do_action(0):
    raise RuntimeError("Could not activate the include checkbox")
named("Commit · 1")
wait_for(lambda node: "+after" in text(node), "real native diff preview")
print("Native WebKit interface loaded a real repository/diff through Tauri IPC and updated file selection.")
named("Settings").get_action_iface().do_action(0)
named("Add to KDE Dolphin").get_action_iface().do_action(0)
target = Path(sys.argv[2]) / "kio/servicemenus/gitpop.desktop"
deadline = time.monotonic() + 5
while not target.is_file() and time.monotonic() < deadline:
    time.sleep(0.1)
if not target.is_file() or "X-GitPop-Managed=true" not in target.read_text():
    raise RuntimeError("Native Dolphin service-menu installation failed")
if not target.stat().st_mode & 0o100:
    raise RuntimeError("Native Dolphin service menu is not executable")
named("Remove menu").get_action_iface().do_action(0)
deadline = time.monotonic() + 5
while target.exists() and time.monotonic() < deadline:
    time.sleep(0.1)
if target.exists():
    raise RuntimeError("Native Dolphin service-menu removal failed")
print("Native Settings installed and removed the Dolphin menu only in the isolated test data directory.")
