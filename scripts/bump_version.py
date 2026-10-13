#!/usr/bin/env python3
"""
bump_version.py - Semantic Versioning Utility for LiveSplit Minimal Overlay
Bumps version in package.json, overlay.js, and index.html synchronously.
Usage: python scripts/bump_version.py [patch|minor|major|<specific_version>]
"""

import sys
import os
import json
import re

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

def main():
    bump_arg = sys.argv[1].strip() if len(sys.argv) > 1 else "patch"
    pkg_path = os.path.join(ROOT_DIR, "package.json")

    with open(pkg_path, "r", encoding="utf-8") as f:
        pkg = json.load(f)

    cur_version = pkg.get("version", "1.0.0")

    if re.match(r'^\d+\.\d+\.\d+$', bump_arg):
        new_version = bump_arg
    else:
        parts = [int(p) for p in cur_version.split(".")]
        if bump_arg == "major":
            parts[0] += 1
            parts[1] = 0
            parts[2] = 0
        elif bump_arg == "minor":
            parts[1] += 1
            parts[2] = 0
        else:  # default patch
            parts[2] += 1
        new_version = f"{parts[0]}.{parts[1]}.{parts[2]}"

    print(f"Bumping version: {cur_version} -> {new_version}")

    # 1. Update package.json
    pkg["version"] = new_version
    with open(pkg_path, "w", encoding="utf-8") as f:
        json.dump(pkg, f, indent=2)
        f.write("\n")

    # 2. Update overlay.js
    overlay_path = os.path.join(ROOT_DIR, "overlay.js")
    with open(overlay_path, "r", encoding="utf-8") as f:
        overlay_src = f.read()
    overlay_src = re.sub(
        r'const APP_VERSION = "v[^"]+";',
        f'const APP_VERSION = "v{new_version}";',
        overlay_src
    )
    with open(overlay_path, "w", encoding="utf-8") as f:
        f.write(overlay_src)

    # 3. Update index.html
    html_path = os.path.join(ROOT_DIR, "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        html_src = f.read()
    html_src = re.sub(
        r'(id="overlay-version"[^>]*>)v[^<]+<',
        rf'\g<1>v{new_version}<',
        html_src
    )
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_src)

    print(f"✓ Successfully synchronized v{new_version} across package.json, overlay.js, and index.html.")

if __name__ == "__main__":
    main()
