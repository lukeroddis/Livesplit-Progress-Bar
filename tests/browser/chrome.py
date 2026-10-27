"""Runs the generated test runner page in headless Chrome and collects results and V8 coverage."""

import asyncio
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import urllib.request

# Collected from the runner page once the total badge reports PASSED/FAILED
_RESULTS_JS = """(() => {
  const badge = document.getElementById('total-badge');
  const failures = [...document.querySelectorAll('.test-row')]
    .filter(r => r.querySelector('.status-pill.error'))
    .map(r => {
      const suite = r.closest('.suite-card')?.querySelector('.suite-title')?.textContent?.trim() || '';
      return (suite ? suite + ' :: ' : '') + r.textContent.trim().replace(/\\s+/g, ' ');
    });
  return JSON.stringify({
    badge: badge ? badge.innerText : '',
    failures,
    scriptErrors: window.__scriptErrors || [],
    initError: window.__initOverlayError ? String(window.__initOverlayError.stack || window.__initOverlayError) : null
  });
})()"""


def find_chrome():
    candidates = [
        os.environ.get("CHROME_BIN"),
        shutil.which("google-chrome"),
        shutil.which("google-chrome-stable"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        shutil.which("chrome"),
        shutil.which("msedge"),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return None


def _find_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        return s.getsockname()[1]


async def _run_with_cdp(chrome_bin, test_url, timeout_sec):
    import websockets

    port = _find_free_port()
    # Chrome 136+ ignores remote debugging when using the default data directory.
    user_data_dir = tempfile.mkdtemp(prefix="livesplit-chrome-")
    proc = subprocess.Popen([
        chrome_bin,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        f"--user-data-dir={user_data_dir}",
        f"--remote-debugging-port={port}",
        "--remote-debugging-address=127.0.0.1",
        "about:blank"
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    try:
        ws_url = None
        for _ in range(150):
            await asyncio.sleep(0.1)
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=1) as resp:
                    targets = json.loads(resp.read().decode())
                page = next((t for t in targets if t.get("type") == "page"), None)
                if page and "webSocketDebuggerUrl" in page:
                    ws_url = page["webSocketDebuggerUrl"]
                    break
            except Exception:
                pass

        if not ws_url:
            raise RuntimeError(f"Could not connect to Chrome debugging port {port}")

        async with websockets.connect(ws_url, max_size=None) as ws:
            msg_id = 1

            async def send_cmd(method, params=None):
                nonlocal msg_id
                cid = msg_id
                msg_id += 1
                await ws.send(json.dumps({"id": cid, "method": method, "params": params or {}}))
                while True:
                    res = json.loads(await ws.recv())
                    if res.get("id") == cid:
                        return res.get("result", {})

            await send_cmd("Profiler.enable")
            await send_cmd("Profiler.startPreciseCoverage", {"callCount": True, "detailed": True})
            await send_cmd("Page.enable")
            await send_cmd("Page.navigate", {"url": test_url})

            results = {"badge": "", "failures": [], "scriptErrors": [], "initError": None}
            for _ in range(int(timeout_sec * 10)):
                await asyncio.sleep(0.1)
                ev = await send_cmd("Runtime.evaluate", {"expression": _RESULTS_JS})
                value = ev.get("result", {}).get("value")
                if value:
                    results = json.loads(value)
                    if "PASSED" in results["badge"] or "FAILED" in results["badge"]:
                        break

            cov = await send_cmd("Profiler.takePreciseCoverage")
            await send_cmd("Profiler.stopPreciseCoverage")
            results["coverage"] = cov.get("result", [])
            return results
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except Exception:
            proc.kill()
        shutil.rmtree(user_data_dir, ignore_errors=True)


def _run_with_dump_dom(chrome_bin, test_url):
    proc = subprocess.run([
        chrome_bin,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--dump-dom",
        test_url
    ], capture_output=True, text=True, errors="replace")
    m = re.search(r'id="total-badge"[^>]*>([^<]+)<', proc.stdout or "")
    return {"badge": m.group(1).strip() if m else "Unknown", "failures": [], "scriptErrors": [], "initError": None, "coverage": []}


def run_runner_page(chrome_bin, runner_path, timeout_sec=15):
    """Returns {badge, failures, scriptErrors, initError, coverage, coverage_available}."""
    test_url = "file:///" + os.path.abspath(runner_path).replace("\\", "/")
    try:
        import websockets  # noqa: F401
        results = asyncio.run(_run_with_cdp(chrome_bin, test_url, timeout_sec))
        results["coverage_available"] = True
    except ImportError:
        results = _run_with_dump_dom(chrome_bin, test_url)
        results["coverage_available"] = False
    return results


def browser_test_count(badge):
    m = re.search(r"(\d+)\s+TESTS PASSED", badge) or re.search(r"(\d+)\s+PASSED", badge)
    return int(m.group(1)) if m else 0
