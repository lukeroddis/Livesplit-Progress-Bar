"""Cross-file structural checks: files exist, parse, and reference each other consistently."""

import os
import re
import shutil
import subprocess

import pytest

from helpers import ROOT_DIR, all_css, index_scripts, index_stylesheets, read_text

APP_FILES = ["index.html", "README.md", "LICENSE", "package.json", "schema/layout-v1.json"]
NODE = shutil.which("node")
BRACKET_PAIRS = {")": "(", "]": "[", "}": "{"}

# Element ids built at runtime from a prefix + index / id
DYNAMIC_ID_PREFIXES = ("item-", "fill-", "delta-", "delta-val-", "time-val-", "node-", "ghost-marker-")


@pytest.mark.parametrize("rel_path", APP_FILES + index_stylesheets() + index_scripts())
def test_file_exists_and_is_utf8(rel_path):
    assert os.path.isfile(os.path.join(ROOT_DIR, rel_path)), f"Missing file: {rel_path}"
    assert read_text(rel_path), f"File is empty: {rel_path}"


@pytest.mark.skipif(NODE is None, reason="node not installed")
@pytest.mark.parametrize("rel_path", index_scripts())
def test_script_parses(rel_path):
    proc = subprocess.run([NODE, "--check", os.path.join(ROOT_DIR, rel_path)], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr


def _bracket_errors(content):
    """Bracket balance outside strings and comments (for HTML/CSS, where no parser is available)."""
    stack, in_str, esc, in_line, in_block = [], None, False, False, False
    line, col, i = 1, 0, 0
    while i < len(content):
        c = content[i]
        col += 1
        if c == "\n":
            line, col, in_line = line + 1, 0, False
        elif in_line:
            pass
        elif in_block:
            if content[i:i + 2] == "*/":
                in_block = False
                i += 1
        elif in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == in_str:
                in_str = None
        elif content[i:i + 2] == "//":
            in_line = True
            i += 1
        elif content[i:i + 2] == "/*":
            in_block = True
            i += 1
        elif c in "\"'`":
            in_str, esc = c, False
        elif c in "([{":
            stack.append((c, line, col))
        elif c in ")]}":
            if not stack:
                return f"unexpected closing '{c}' at {line}:{col}"
            top, tl, tc = stack.pop()
            if BRACKET_PAIRS[c] != top:
                return f"mismatched '{c}' at {line}:{col}, opened '{top}' at {tl}:{tc}"
        i += 1
    return f"unclosed '{stack[-1][0]}' from {stack[-1][1]}:{stack[-1][2]}" if stack else None


@pytest.mark.parametrize("rel_path", ["index.html"] + index_stylesheets())
def test_brackets_balanced(rel_path):
    assert _bracket_errors(read_text(rel_path)) is None


def test_overlay_window_exports_are_defined_at_top_level():
    """window.x = x; in overlay.js must refer to a top-level declaration (else a ReferenceError at load)."""
    code = read_text("overlay.js")
    missing = [sym for sym in re.findall(r"window\.([a-zA-Z0-9_]+)\s*=\s*\1;", code)
               if not re.search(r"^(?:function\s+|const\s+|let\s+)" + sym + r"\b", code, re.MULTILINE)]
    assert not missing, f"overlay.js exports undeclared identifiers: {missing}"


@pytest.mark.parametrize("rel_path", index_scripts())
def test_dom_ids_exist_in_index_html(rel_path):
    defined = set(re.findall(r'id=["\']([^"\']+)["\']', read_text("index.html")))
    queried = re.findall(r'getElementById\(["\']([^"\'$`]+)["\']\)', read_text(rel_path))
    missing = sorted({q for q in queried if q not in defined and not q.startswith(DYNAMIC_ID_PREFIXES)})
    assert not missing, f"{rel_path} references ids missing from index.html: {missing}"


def _registered_names(src, registry):
    """Names provided via Object.assign(<registry>, { a, b: c, ... }) blocks."""
    names = set()
    for block in re.findall(r"Object\.assign\(" + registry + r",\s*\{(.*?)\}\);", src, re.S):
        for entry in re.findall(r"^\s*(\w+)\s*(?::|,|$)", block, re.M):
            names.add(entry)
    return names


# registry variable -> (file that owns it, regex marking files installed onto it, names seeded at creation)
REGISTRIES = {
    "app": ("overlay.js", r"function install\w+\(app\)", {"state"}),
    "ctx": ("src/core/race-client.js", r"function install\w+\(ctx\)", {"raceState"}),
}


@pytest.mark.parametrize("registry", sorted(REGISTRIES))
def test_registry_calls_are_provided(registry):
    """Every <registry>.<name> a controller uses must be registered by an install*(registry) or its owner."""
    owner, install_re, provided = REGISTRIES[registry]
    provided = set(provided)
    used = {}
    for rel in index_scripts():
        src = read_text(rel)
        if rel != owner and not re.search(install_re, src):
            continue
        provided |= _registered_names(src, registry)
        provided |= set(re.findall(r"const \{\s*\w+,\s*(\w+)\s*\} = " + registry + ";", src))
        for name in re.findall(r"(?<![\w$.])" + registry + r"\.(\w+)", src):
            used.setdefault(name, set()).add(rel)
    missing = {n: sorted(f) for n, f in used.items() if n not in provided}
    assert not missing, f"{registry}.<name> used but never registered: {missing}"


def test_css_classes_toggled_by_js_are_styled():
    """Every class name JS adds/toggles/removes must have a rule in src/styles/."""
    css = re.sub(r"/\*.*?\*/", "", all_css(), flags=re.S)
    styled = set(re.findall(r"\.(-?[_a-zA-Z][\w-]*)", css))
    missing = {}
    for rel in index_scripts():
        for m in re.finditer(r"classList\.(?:add|toggle|remove)\(\s*([^)]*)\)", read_text(rel)):
            # toggle(name, force): only leading string arguments are class names
            for name in re.findall(r"^\s*[\"']([\w-]+)[\"']|,\s*[\"']([\w-]+)[\"']", m.group(1)):
                cls = name[0] or name[1]
                if cls and cls not in styled:
                    missing.setdefault(cls, set()).add(rel)
    assert not missing, "Classes toggled in JS without CSS rules: " + ", ".join(
        f"{c} ({', '.join(sorted(f))})" for c, f in sorted(missing.items()))
