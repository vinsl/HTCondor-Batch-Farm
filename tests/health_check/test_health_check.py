"""Tests of the health check. Nothing here touches the real disk or systemd: both are replaced."""

import importlib.util
import pathlib
from types import SimpleNamespace

SCRIPT = (
    pathlib.Path(__file__).resolve().parents[2]
    / "puppet/site-modules/profile/files/htcondor/health_check.py"
)
spec = importlib.util.spec_from_file_location("health_check", SCRIPT)
hc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hc)


def fake_usage(total, free):
    return lambda path: SimpleNamespace(total=total, used=total - free, free=free)


def test_disk_ok_with_enough_space(monkeypatch):
    monkeypatch.setattr(hc.shutil, "disk_usage", fake_usage(100, 50))
    assert hc.disk_ok("/x", 0.10) is True


def test_disk_not_ok_when_almost_full(monkeypatch):
    monkeypatch.setattr(hc.shutil, "disk_usage", fake_usage(100, 5))
    assert hc.disk_ok("/x", 0.10) is False


def test_disk_exactly_at_the_minimum_is_ok(monkeypatch):
    monkeypatch.setattr(hc.shutil, "disk_usage", fake_usage(100, 10))
    assert hc.disk_ok("/x", 0.10) is True


def fake_run(returncode):
    return lambda *args, **kwargs: SimpleNamespace(
        returncode=returncode, stdout=b"", stderr=b""
    )


def test_service_active_when_systemctl_returns_zero(monkeypatch):
    monkeypatch.setattr(hc.subprocess, "run", fake_run(0))
    assert hc.service_active("chronyd") is True


def test_service_inactive_when_systemctl_returns_nonzero(monkeypatch):
    monkeypatch.setattr(hc.subprocess, "run", fake_run(3))
    assert hc.service_active("chronyd") is False


def test_evaluate_healthy(monkeypatch):
    monkeypatch.setattr(hc, "disk_ok", lambda path, ratio: True)
    monkeypatch.setattr(hc, "service_active", lambda name: True)
    assert hc.evaluate() == (True, "ok")


def test_evaluate_reports_the_disk(monkeypatch):
    monkeypatch.setattr(hc, "disk_ok", lambda path, ratio: False)
    monkeypatch.setattr(hc, "service_active", lambda name: True)
    healthy, reason = hc.evaluate()
    assert healthy is False and "disk" in reason


def test_evaluate_reports_the_failed_service(monkeypatch):
    monkeypatch.setattr(hc, "disk_ok", lambda path, ratio: True)
    monkeypatch.setattr(hc, "service_active", lambda name: False)
    healthy, reason = hc.evaluate()
    assert healthy is False and "chronyd" in reason


def test_classad_for_a_healthy_node():
    assert (
        hc.format_classad(True, "ok")
        == 'NODE_IS_HEALTHY = True\nNODE_HEALTH_REASON = "ok"\n'
    )


def test_classad_for_a_sick_node():
    out = hc.format_classad(False, "service chronyd is not active")
    assert (
        out
        == 'NODE_IS_HEALTHY = False\nNODE_HEALTH_REASON = "service chronyd is not active"\n'
    )
