"""Baseline UI + graphics capture for Hollow Grove."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

URL = os.environ.get("URL", "http://localhost:8080/")
OUT = os.environ.get("OUT", str(Path(__file__).with_name("baseline.png")))
WAIT_MS = int(os.environ.get("WAIT", "9000"))

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.goto(URL, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(WAIT_MS)
    page.screenshot(path=OUT, full_page=False)
    info = page.evaluate("""() => ({
        title: document.title,
        loaderDone: document.getElementById('loader')?.classList.contains('done') ?? null,
        hudVisible: !!document.getElementById('hud'),
        canvas: [document.getElementById('game')?.width, document.getElementById('game')?.height],
        activeMode: document.querySelector('.mode-btn.is-active')?.textContent?.trim() ?? null,
        wave: document.getElementById('hud-wave')?.textContent ?? null,
        souls: document.getElementById('hud-souls')?.textContent ?? null,
        houseHp: document.getElementById('hud-house-hp')?.style.width ?? null,
        agentWeapon: document.getElementById('agent-weapon')?.textContent ?? null,
        agentAction: document.getElementById('agent-action')?.textContent ?? null,
        aiStatus: document.getElementById('ai-status')?.textContent ?? null,
        aiSub: document.getElementById('ai-sub')?.textContent ?? null,
        metrics: {
          waves: document.getElementById('m-waves')?.textContent ?? null,
          bestWave: document.getElementById('m-best-wave')?.textContent ?? null,
          holdRate: document.getElementById('m-hold-rate')?.textContent ?? null,
          steps: document.getElementById('m-steps')?.textContent ?? null,
          reward: document.getElementById('m-reward')?.textContent ?? null,
          entropy: document.getElementById('m-entropy')?.textContent ?? null,
        },
    })""")
    print(json.dumps({"info": info, "errors": errors}, indent=2))
    browser.close()
