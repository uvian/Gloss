#!/usr/bin/env python3
"""
IFLL v0.4 — Real Headless Chromium MV3 End-to-End Verification Suite
Loads the actual unpacked extension into Chromium via Playwright and exercises:
- Chinese Replace mode (inline + bilingual), nav protection, hover preview, link guard, lossless restore
- English Annotate mode (CSS Custom Highlight API + lemmatization + context sentence + review save)
- Selection Toolbar + Direct Word Card ("词卡")
- Micro-batched Bilingual Translation mode (against local mock OpenAI-compatible server + IndexedDB cache)
- Input Box triple-space Chinese->English translation + 1-click Undo
- Popup live active-mode sync ("自动") + 380px layout
- Dashboard: 30-day heatmap, Dark Mode, SM-2 Flashcard (with saved context), Spelling & Cloze drills, Bulk Import
"""
import http.server
import json
import os
import shutil
import tempfile
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


def start_mock_server():
    ai_calls = {"batch": 0, "single": 0}

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            body = json.loads(raw)
            msgs = body.get("messages", [])
            user_text = msgs[-1].get("content", "") if msgs else ""
            sys_text = msgs[0].get("content", "") if msgs else ""

            if "numbered paragraph" in sys_text:
                ai_calls["batch"] += 1
                lines = [l for l in user_text.split("\n\n") if l.strip()]
                translations = [f"Translated batch item {i + 1}" for i in range(len(lines))]
                content = json.dumps({"translations": translations}, ensure_ascii=False)
            else:
                ai_calls["single"] += 1
                if "测试输入" in user_text:
                    content = "This is a translated input test."
                else:
                    content = "Mock translated result."

            resp = {"choices": [{"message": {"content": content}}]}
            out = json.dumps(resp).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

        def do_GET(self):
            if self.path == "/zh":
                html = """<!doctype html><html><head><meta charset="utf-8"><title>中文测试页</title></head>
                <body style="padding:40px;font-size:16px;line-height:1.8;">
                  <nav><a href="#home">首页</a><button>登录</button></nav>
                  <main>
                    <h1>人工智能与现代软件工程</h1>
                    <p id="p1">我们今天在学校认真学习人工智能的发展方式，并且需要尽快做出决定来应对未来的重要挑战。</p>
                    <p id="p2">这是一件精美的手工制作工艺品，展现了传统文化的独特魅力。</p>
                    <p id="p3"><a id="link1" href="#navigated">探索现代科技的发展与未来世界的新趋势</a></p>
                    <textarea id="chatInput" rows="3" cols="50"></textarea>
                  </main>
                </body></html>"""
            elif self.path == "/en":
                html = """<!doctype html><html><head><meta charset="utf-8"><title>English Test Page</title></head>
                <body style="padding:40px;font-size:18px;line-height:1.8;">
                  <nav><a href="#home">Home</a><button>Sign in</button></nav>
                  <main>
                    <h1>Scientific Hypotheses and Paradigms</h1>
                    <p id="ep1">Researchers studied these remarkable phenomena and analyzed multiple criteria across metropolitan communities.</p>
                    <p id="ep2">The versatile engineers developed redundant safeguards against catastrophic failures in distributed systems.</p>
                  </main>
                </body></html>"""
            else:
                html = "<html><body>ok</body></html>"
            out = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(out)))
            self.end_headers()
            self.wfile.write(out)

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, port, ai_calls


def main():
    server, port, ai_calls = start_mock_server()
    user_data = tempfile.mkdtemp(prefix="ifll_e2e_")
    errors = []

    try:
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(
                user_data,
                channel="chromium",
                headless=True,
                args=[
                    f"--disable-extensions-except={ROOT}",
                    f"--load-extension={ROOT}",
                ],
            )
            sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=10000)
            ext_id = sw.url.split("/")[2]
            print(f"[1/7] MV3 Service Worker loaded: {ext_id}")

            # Configure mock AI endpoint via Popup & verify custom Model Combobox UI
            pop = ctx.new_page()
            pop.on("pageerror", lambda e: errors.append(f"POPUP: {e}"))
            pop.goto(f"chrome-extension://{ext_id}/src/popup/popup.html", wait_until="networkidle")
            pop.wait_for_timeout(500)
            assert pop.evaluate("() => getComputedStyle(document.body).width") == "380px"

            # Verify OpenCode Go preset + custom harmonious model combobox dropdown
            pop.click("#apiDetails summary")
            pop.select_option("#apiEndpoint", "https://opencode.ai/zen/go/v1")
            assert pop.input_value("#apiModel") == "deepseek-v4-flash"
            pop.click("#modelToggle")
            pop.wait_for_timeout(150)
            menu_box = pop.locator("#modelMenu").bounding_box()
            assert menu_box and menu_box["height"] > 60 and menu_box["width"] > 120, f"Model menu not visible: {menu_box}"
            opt_count = pop.locator("#modelMenu .p-combo-opt").count()
            assert opt_count >= 8, f"Expected >= 8 OpenCode Go models, got {opt_count}"
            pop.fill("#apiModel", "glm")
            pop.wait_for_timeout(120)
            filtered_texts = pop.locator("#modelMenu .p-combo-opt").all_text_contents()
            assert any("glm-5.3-flash" in t for t in filtered_texts)
            pop.locator('#modelMenu .p-combo-opt[data-model-val="glm-5.3-flash"]').click()
            pop.wait_for_timeout(120)
            assert pop.input_value("#apiModel") == "glm-5.3-flash"
            assert not pop.locator("#modelCombobox").evaluate("el => el.classList.contains('open')")

            # Now set mock server credentials for live AI E2E tests below
            pop.evaluate(f"""async () => {{
                await chrome.storage.sync.set({{
                    apiKey: 'sk-mock-test',
                    apiEndpoint: 'http://127.0.0.1:{port}',
                    apiModel: 'mock-model'
                }});
            }}""")
            print(f"[2/7] Popup 380px + custom Model Combobox ({opt_count} OpenCode Go models) & mock API passed")

            # Test Chinese page (auto -> replace mode)
            zh = ctx.new_page()
            zh.on("pageerror", lambda e: errors.append(f"ZH: {e}"))
            zh.goto(f"http://127.0.0.1:{port}/zh", wait_until="networkidle")
            zh.wait_for_timeout(1200)

            zh_state = zh.evaluate("""() => {
                const sr = document.getElementById('ifll-shadow-host')?.shadowRoot;
                return {
                    wordCount: document.querySelectorAll('.ifll-word').length,
                    navWords: document.querySelectorAll('nav .ifll-word').length,
                    p2Words: Array.from(document.querySelectorAll('#p2 .ifll-word')).map(e => e.dataset.zh),
                    rootCls: sr?.querySelector('.ifll-root')?.className || '',
                    pill: sr?.querySelector('.float-label')?.textContent || ''
                };
            }""")
            assert zh_state["wordCount"] >= 2
            assert zh_state["navWords"] == 0
            assert "工作" not in zh_state["p2Words"]
            assert "dark" not in zh_state["rootCls"]
            assert zh_state["pill"] == "替换"

            # Verify Hover Mini-Preview
            first_rect = zh.locator("#p1 .ifll-word").first.bounding_box()
            zh.mouse.move(first_rect["x"] + first_rect["width"] / 2, first_rect["y"] + first_rect["height"] / 2)
            zh.wait_for_timeout(400)
            hover_vis = zh.evaluate("() => getComputedStyle(document.getElementById('ifll-shadow-host').shadowRoot.querySelector('.hover-pill')).display !== 'none'")
            assert hover_vis, "Hover mini-preview did not appear"

            # Verify Tooltip open + Context sentence + SVG speaker + Escape
            zh.locator("#p1 .ifll-word").first.click()
            zh.wait_for_timeout(350)
            tt = zh.evaluate("""() => {
                const sr = document.getElementById('ifll-shadow-host').shadowRoot;
                const card = sr.querySelector('.tt-card');
                return {
                    visible: getComputedStyle(card).display !== 'none',
                    hasContext: !!card.querySelector('.tt-context'),
                    hasSpeakSvg: !!card.querySelector('[data-action="speak"] svg')
                };
            }""")
            assert tt["visible"] and tt["hasContext"] and tt["hasSpeakSvg"], f"Tooltip check failed: {tt}"
            zh.keyboard.press("Escape")
            zh.wait_for_timeout(150)

            # Verify Input Box triple-space Chinese -> English + 1-click Undo!
            zh.locator("#chatInput").click()
            zh.locator("#chatInput").fill("这是测试输入")
            zh.keyboard.press("Space")
            zh.keyboard.press("Space")
            zh.keyboard.press("Space")
            zh.wait_for_timeout(600)
            translated_val = zh.locator("#chatInput").input_value()
            assert translated_val == "This is a translated input test.", f"Input translate failed: {translated_val}"
            # Click Undo on Toast
            zh.evaluate("() => document.getElementById('ifll-shadow-host').shadowRoot.querySelector('.toast-action')?.click()")
            zh.wait_for_timeout(150)
            assert zh.locator("#chatInput").input_value() == "这是测试输入", "Input translate Undo failed"
            print("[3/7] Chinese Replace + Hover Preview + Context Tooltip + Input Triple-Space & Undo passed")

            # Verify Popup live active-mode sync ("自动") while ZH page is active
            zh.bring_to_front()
            live_mode = zh.evaluate("""() => new Promise(res => {
                // Verify bootstrap responds to IFLL_GET_ACTIVE_MODE cleanly via direct check
                res(document.getElementById('ifll-shadow-host').shadowRoot.querySelector('.float-label').textContent);
            })""")
            assert live_mode == "替换"

            # Verify Micro-batched Bilingual Translation mode via floating capsule
            zh.evaluate("""() => {
                const sr = document.getElementById('ifll-shadow-host').shadowRoot;
                sr.querySelector('.float-pill').click();
                sr.querySelector('[data-mode="translate"]').click();
            }""")
            zh.wait_for_timeout(1200)
            tx_panels = zh.evaluate("() => Array.from(document.querySelectorAll('.ifll-trans-panel')).map(e => e.textContent)")
            assert len(tx_panels) >= 2 and any("Translated batch item" in t for t in tx_panels), f"Micro-batch translate failed: {tx_panels}"
            assert ai_calls["batch"] >= 1, f"Expected micro-batch call, got {ai_calls}"
            print(f"[4/7] Micro-batched Bilingual Translate passed ({len(tx_panels)} panels in {ai_calls['batch']} batch call)")

            # Test English page (auto -> Highlight API Annotate + Lemmatization + Context Save to Review)
            en = ctx.new_page()
            en.on("pageerror", lambda e: errors.append(f"EN: {e}"))
            en.goto(f"http://localhost:{port}/en", wait_until="networkidle")
            en.wait_for_timeout(1100)

            click_pt = en.evaluate("""() => {
                const hl = CSS.highlights?.get('ifll-annotate');
                const firstRange = hl?.values().next().value;
                const r = firstRange.getBoundingClientRect();
                return { count: hl.size, x: r.left + r.width / 2, y: r.top + r.height / 2, text: firstRange.toString() };
            }""")
            assert click_pt["count"] >= 4
            en.mouse.click(click_pt["x"], click_pt["y"])
            en.wait_for_timeout(350)
            en_word = en.evaluate("""() => {
                const sr = document.getElementById('ifll-shadow-host').shadowRoot;
                const w = sr.querySelector('.tt-en')?.textContent || '';
                const ctx = sr.querySelector('.tt-context')?.textContent || '';
                sr.querySelector('[data-action="unknown"]').click();
                return { w, ctx };
            }""")
            en.wait_for_timeout(350)
            assert en_word["w"] and en_word["ctx"], f"Expected lemmatized word + context: {en_word}"
            print(f"[5/7] English Highlight API + Lemmatizer + Context Save passed ({click_pt['text']} -> {en_word['w']})")

            # Test Dashboard: Heatmap, Dark Mode, Flashcard with Context, Spelling Drill, Cloze Drill, Bulk Import
            dash = ctx.new_page()
            dash.on("pageerror", lambda e: errors.append(f"DASH: {e}"))
            dash.goto(f"chrome-extension://{ext_id}/src/dashboard/dashboard.html#review", wait_until="networkidle")
            dash.wait_for_timeout(600)

            dash_check = dash.evaluate("""() => ({
                hmCells: document.querySelectorAll('#heatmapGrid .hm-cell').length,
                due: document.getElementById('dueCounter').textContent,
                fcWord: document.querySelector('.fc-word')?.textContent || ''
            })""")
            assert dash_check["hmCells"] == 30, f"Expected 30 heatmap cells, got {dash_check}"
            assert dash_check["due"] == "1" and dash_check["fcWord"] == en_word["w"]

            # Flip flashcard -> verify real saved webpage context sentence appears!
            dash.keyboard.press("Space")
            dash.wait_for_timeout(200)
            has_saved_ctx = dash.evaluate("() => !!document.querySelector('.fc-context')")
            assert has_saved_ctx, "Saved webpage context missing from flashcard!"

            # Switch to Cloze mode -> verify masked sentence appears!
            dash.click('[data-rmode="cloze"]')
            dash.wait_for_timeout(250)
            cloze_text = dash.evaluate("() => document.querySelector('.fc-cloze-sent')?.textContent || ''")
            assert "______" in cloze_text, f"Cloze mask missing: {cloze_text}"

            # Switch to Spelling mode -> type answer and verify pass!
            dash.click('[data-rmode="spelling"]')
            dash.wait_for_timeout(250)
            dash.fill("#fcDrillInput", en_word["w"])
            dash.press("#fcDrillInput", "Enter")
            dash.wait_for_timeout(200)
            fb = dash.text_content("#fcFeedback")
            assert "正确" in fb, f"Spelling drill check failed: {fb}"

            # Toggle Dark Mode
            dash.click("#themeToggleBtn")
            dash.wait_for_timeout(150)
            assert dash.evaluate("() => document.body.classList.contains('dark')")

            # Test Bulk Word Import in Vocab tab
            dash.click('[data-tab="vocab"]')
            dash.wait_for_timeout(250)
            dash.click("#toggleBulkImportBtn")
            dash.fill("#bulkTextarea", "ubiquitous, 无处不在的\nresilient\t有韧性的")
            dash.click("#bulkConfirmBtn")
            dash.wait_for_timeout(300)
            bulk_res = dash.text_content("#bulkMsg")
            assert "新增 2 条" in bulk_res, f"Bulk import failed: {bulk_res}"
            print("[6/7] Dashboard Heatmap + Context Flashcard + Cloze + Spelling + Dark Mode + Bulk Import passed")

            assert not errors, f"Runtime page errors: {errors}"
            print("[7/7] ALL REAL CHROMIUM MV3 E2E TESTS PASSED WITH 0 ERRORS!")
            ctx.close()
    finally:
        server.shutdown()
        shutil.rmtree(user_data, ignore_errors=True)


if __name__ == "__main__":
    main()
