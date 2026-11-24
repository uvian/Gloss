#!/usr/bin/env bash
# IFLL — Package clean Firefox Desktop & Firefox for Android .xpi archive
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

python3 - <<'PY'
import json
import zipfile
from pathlib import Path

root = Path(".").resolve()
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))

# Verify Firefox Desktop & Android MV3 requirements before packaging
bg = manifest.get("background", {})
bss = manifest.get("browser_specific_settings", {})
if len(manifest.get("name", "")) > 45:
    raise SystemExit(f"ERROR: manifest.json name exceeds Firefox 45-char limit ({len(manifest['name'])} chars).")
if not bg.get("scripts"):
    raise SystemExit("ERROR: manifest.json is missing background.scripts for Firefox.")
if not bss.get("gecko", {}).get("id"):
    raise SystemExit("ERROR: manifest.json is missing browser_specific_settings.gecko.id.")
if "gecko_android" not in bss:
    raise SystemExit("ERROR: manifest.json is missing browser_specific_settings.gecko_android.")

version = manifest.get("version", "0.0.0")
dist_dir = root / "dist"
dist_dir.mkdir(exist_ok=True)
out_path = dist_dir / f"ifll-firefox-v{version}.xpi"

# Build a Firefox-specific manifest copy inside the .xpi without background.service_worker
# so AMO addons-linter produces 0 warnings while repo manifest.json remains Chrome+Firefox dual-ready.
ff_manifest = json.loads(json.dumps(manifest))
ff_manifest.get("background", {}).pop("service_worker", None)
ff_manifest_bytes = (json.dumps(ff_manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

include_files = []
if (root / "LICENSE").exists():
    include_files.append(root / "LICENSE")

for folder in ("icons", "src"):
    for p in sorted((root / folder).rglob("*")):
        if p.is_file() and "__pycache__" not in p.parts and not p.name.startswith("."):
            include_files.append(p)

with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    zf.writestr("manifest.json", ff_manifest_bytes)
    for p in include_files:
        zf.write(p, p.relative_to(root).as_posix())

size_kb = out_path.stat().st_size / 1024
print(f"Packed {len(include_files) + 1} files -> {out_path.relative_to(root)} ({size_kb:.1f} KB) [Firefox-clean manifest]")
print("")
print("Firefox for Android 安装说明:")
print("  1. 自发行签名（推荐，长期使用）: 登录 https://addons.mozilla.org/developers/ -> 提交新扩展/上传新版本 -> 选择「自行分发 (On your own)」上传此 .xpi，下载 Mozilla 自动签名后的 .xpi 文件。")
print("  2. 在手机 Firefox 中: 设置 -> 关于 Firefox -> 连点 5 次 Firefox 图标开启调试模式 -> 返回设置 -> 「从文件安装扩展」选择已签名的 .xpi。")
print("  3. 开发调试（无需签名）: 手机开启「通过 USB 远程调试」，电脑运行 npx web-ext run -t firefox-android --android-device <device_id>")
PY
