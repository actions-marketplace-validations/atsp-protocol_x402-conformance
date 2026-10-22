"""Not named test_*.py on purpose: it needs pytest, which the core package doesn't depend on, so the plain unittest run
skips it and the pytest-plugin CI job runs it (unittest discover -s tests -p check_pytest_plugin.py).

The pytest plugin, run the way a user runs it: pytest on a test file that uses the `x402` fixture. Skipped when
pytest isn't installed (the core package has no dependencies). The probe cases need Node and the built TypeScript
package (ts/dist) and, for FastAPI, the x402 Python SDK; X402CONF_REQUIRE_PROBE=1 turns those skips into failures, as
the pytest-plugin CI job sets it."""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HAVE_PYTEST = importlib.util.find_spec("pytest") is not None
HAVE_NODE = shutil.which("node") is not None and os.path.exists(os.path.join(ROOT, "ts/dist/src/cli.js"))
HAVE_FASTAPI = importlib.util.find_spec("x402") is not None and importlib.util.find_spec("fastapi") is not None
REQUIRE = os.environ.get("X402CONF_REQUIRE_PROBE") == "1"

SERVER = textwrap.dedent('''
    import base64, json, threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
    GOOD = {"x402Version": 2, "resource": {"url": "http://127.0.0.1/paid"}, "accepts": [{"scheme": "exact",
            "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", "asset": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
            "payTo": "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", "amount": "1000", "maxTimeoutSeconds": 60,
            "extra": {"feePayer": "11111111111111111111111111111111"}}]}
    BAD = json.loads(json.dumps(GOOD)); BAD["accepts"][0]["extra"] = {}
    UA = []
    class H(BaseHTTPRequestHandler):
        def do_GET(self):
            UA.append(self.headers.get("user-agent"))
            body = GOOD if self.path == "/good" else BAD
            self.send_response(402)
            self.send_header("payment-required", base64.b64encode(json.dumps(body).encode()).decode())
            self.end_headers()
        def log_message(self, *a):
            pass
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    BASE = f"http://127.0.0.1:{srv.server_address[1]}"
''')


def run_pytest(test_src: str, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    d = tempfile.mkdtemp()
    with open(os.path.join(d, "test_x.py"), "w") as f:
        f.write(SERVER + textwrap.dedent(test_src))
    e = {**os.environ, "PYTHONPATH": os.path.join(ROOT, "src"), **(env or {})}
    e.pop("X402CONF_VIA", None)
    return subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-p", "x402conf.pytest_plugin",
                           os.path.join(d, "test_x.py"), *args], env=e, capture_output=True, text=True, timeout=900, cwd=d)


@unittest.skipUnless(HAVE_PYTEST, "pytest is not installed")
class Plugin(unittest.TestCase):
    def test_check_payment_required_passes_and_fails_with_fix_links(self):
        p = run_pytest('''
            def test_good(x402):
                r = x402.check_payment_required(BASE + "/good")
                x402.assert_passed(r)
                assert r["via"] == "pytest" and r["schema"] == "x402-conformance.report/1"
                assert UA[-1].endswith("via=pytest)")
            def test_bad(x402):
                x402.assert_passed(x402.check_payment_required(BASE + "/bad"))
        ''')
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("1 failed, 1 passed", p.stdout)
        self.assertIn("P5 scheme-specific extra fields are present", p.stdout)
        self.assertIn("FIXES.md#p5", p.stdout)
        self.assertIn("x402-conformance", p.stdout)
        self.assertIn("re-run with --x402-share", p.stdout)

    def test_share_writes_the_case_and_report_dir_the_reports(self):
        d = tempfile.mkdtemp()
        p = run_pytest('''
            def test_bad(x402):
                x402.assert_passed(x402.check_payment_required(BASE + "/bad"))
        ''', "--x402-share", "--x402-report-dir", d)
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("nothing was sent", p.stdout)
        self.assertIn("issues/new?template=corpus-case.yml", p.stdout)
        with open(os.path.join(d, "x402-conformance-case-resource-402-1.json")) as f:
            case = json.load(f)
        self.assertEqual((case["via"], case["failed_ids"], case["target"]), ("pytest", ["P5"], "loopback"))
        self.assertTrue(os.path.exists(os.path.join(d, "resource-402-1.json")))

    def test_all_passing_suggests_the_badge(self):
        p = run_pytest('''
            def test_good(x402):
                x402.assert_passed(x402.check_payment_required(BASE + "/good"))
        ''')
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertIn("Add the badge", p.stdout)

    @unittest.skipUnless(HAVE_NODE or REQUIRE, "Node or ts/dist missing")
    def test_probe_passes_the_reference_and_fails_a_faulty_server(self):
        server = os.path.join(ROOT, "ts/dist/example/server.js")
        p = run_pytest(f'''
            def test_reference(x402):
                r = x402.probe("http://127.0.0.1:4720/paid", port=4721, start="PORT=4720 node {server}")
                x402.assert_passed(r)
                assert len(r["results"]) == 11 and r["via"] == "pytest"
            def test_faulty(x402):
                r = x402.probe("http://127.0.0.1:4722/paid", port=4723,
                               start="PORT=4722 EXAMPLE_FAULT=serve_on_any_settle node {server}")
                assert set(r["summary"]["failed_ids"]) >= {{"R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9"}}
                x402.assert_passed(r)
        ''', env={"X402CONF_SVM": f"node {os.path.join(ROOT, 'ts/dist/src/cli.js')}"})
        self.assertIn("1 failed, 1 passed", p.stdout, p.stdout + p.stderr)
        self.assertIn("FIXES.md#r3", p.stdout)

    @unittest.skipUnless((HAVE_NODE and HAVE_FASTAPI) or REQUIRE, "Node, ts/dist or the x402 Python SDK missing")
    def test_probe_passes_the_stock_fastapi_middleware(self):
        app = os.path.join(ROOT, "examples/python/fastapi_server.py")
        p = run_pytest(f'''
            import sys
            def test_fastapi(x402):
                r = x402.probe("http://127.0.0.1:4730/paid", port=4731, start=f"PORT=4730 {{sys.executable}} {app}")
                x402.assert_passed(r)
                assert len(r["results"]) == 11
        ''', env={"X402CONF_SVM": f"node {os.path.join(ROOT, 'ts/dist/src/cli.js')}"})
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)

    def test_probe_without_node_is_a_usage_error_not_a_crash(self):
        p = run_pytest('''
            def test_probe(x402):
                r = x402.probe("http://127.0.0.1:4740/paid")
                assert "could not run x402conf-svm" in r["error"]
                x402.assert_passed(r)
        ''', env={"X402CONF_SVM": "/nonexistent/x402conf-svm"})
        self.assertEqual(p.returncode, 1, p.stdout + p.stderr)
        self.assertIn("could not complete", p.stdout)


if __name__ == "__main__":
    unittest.main()
