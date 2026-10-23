#!/usr/bin/env python3
"""
determine_bump.py - Intelligent Release Version Bump Detector for GitHub Actions

Determines whether a pull request or workflow dispatch should create a new release
and what version bump (major, minor, patch, none) to apply.

Automatically skips releases when changes are restricted to non-runtime files:
- Documentation (*.md, docs/*)
- Test suite (tests/*)
- CI / Workflow configs (.github/*, .githooks/*)
- Git meta files (.gitignore, .gitattributes, LICENSE)
- Conventional commit non-release prefixes (test:, docs:, chore:, ci:, build:, style:)
"""

import fnmatch
import os
import re
import subprocess
import sys

NON_RUNTIME_PATTERNS = [
    "tests/*",
    "*.md",
    ".github/*",
    ".githooks/*",
    ".gitignore",
    ".gitattributes",
    "LICENSE",
    "docs/*",
]

NON_RELEASE_TITLE_REGEX = re.compile(
    r"^(test|docs|chore|ci|build|style)(\([a-zA-Z0-9_\-\./]+\))?:\s*",
    re.IGNORECASE,
)

def export_env(key: str, value: str):
    print(f"Setting {key}={value}")
    github_env = os.environ.get("GITHUB_ENV")
    if github_env:
        try:
            with open(github_env, "a", encoding="utf-8") as f:
                f.write(f"{key}={value}\n")
        except Exception as e:
            print(f"Warning: could not write to GITHUB_ENV: {e}")

def get_changed_files(base_sha: str, head_sha: str) -> list[str]:
    # 1. Try git diff with base and head SHAs
    if base_sha and head_sha:
        try:
            res = subprocess.run(
                ["git", "diff", "--name-only", base_sha, head_sha],
                capture_output=True,
                text=True,
                check=True,
            )
            files = [line.strip() for line in res.stdout.splitlines() if line.strip()]
            if files:
                return files
        except Exception as e:
            print(f"Warning: git diff {base_sha}..{head_sha} failed: {e}")

    # 2. Fallback to HEAD~1..HEAD or HEAD^!
    for cmd in [["git", "diff", "--name-only", "HEAD~1", "HEAD"], ["git", "diff", "--name-only", "HEAD^!"]]:
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=True)
            files = [line.strip() for line in res.stdout.splitlines() if line.strip()]
            if files:
                return files
        except Exception:
            pass

    return []

def has_runtime_changes(changed_files: list[str]) -> bool:
    for file_path in changed_files:
        norm_path = file_path.replace("\\", "/")
        is_ignored = False
        for pat in NON_RUNTIME_PATTERNS:
            if fnmatch.fnmatch(norm_path, pat):
                is_ignored = True
                break
        if not is_ignored:
            print(f"Runtime change detected in: {norm_path}")
            return True
    return False

def main():
    event_name = os.environ.get("EVENT_NAME", "").strip()
    input_bump = os.environ.get("INPUT_BUMP", "none").strip()
    pr_title = os.environ.get("PR_TITLE", "").strip()
    pr_labels = [lbl.strip().lower() for lbl in os.environ.get("PR_LABELS", "").split() if lbl.strip()]
    base_sha = os.environ.get("BASE_SHA", "").strip()
    head_sha = os.environ.get("HEAD_SHA", "").strip()

    if event_name == "workflow_dispatch":
        export_env("BUMP_TYPE", input_bump or "patch")
        export_env("SKIP_RELEASE", "false" if input_bump != "none" else "true")
        return

    if event_name == "pull_request":
        # 1. Explicit skip labels
        if any(lbl in ["skip-release", "no-release", "skip"] for lbl in pr_labels):
            print("Explicit skip-release label detected: Skipping release.")
            export_env("SKIP_RELEASE", "true")
            export_env("BUMP_TYPE", "none")
            return

        # 2. Explicit bump labels (take priority)
        if "major" in pr_labels:
            print("Explicit 'major' label detected: Bumping major version.")
            export_env("BUMP_TYPE", "major")
            export_env("SKIP_RELEASE", "false")
            return
        if "minor" in pr_labels:
            print("Explicit 'minor' label detected: Bumping minor version.")
            export_env("BUMP_TYPE", "minor")
            export_env("SKIP_RELEASE", "false")
            return
        if "patch" in pr_labels:
            print("Explicit 'patch' label detected: Bumping patch version.")
            export_env("BUMP_TYPE", "patch")
            export_env("SKIP_RELEASE", "false")
            return

        # 3. File Diff Inspection
        changed_files = get_changed_files(base_sha, head_sha)
        print("=== Files Modified in Merged PR ===")
        for f in changed_files:
            print(f" - {f}")
        print("===================================")

        if changed_files and not has_runtime_changes(changed_files):
            print("Only test suite, documentation, or CI files modified: Skipping release.")
            export_env("SKIP_RELEASE", "true")
            export_env("BUMP_TYPE", "none")
            return

        # 4. Conventional Commit PR Title detection
        if pr_title and NON_RELEASE_TITLE_REGEX.match(pr_title):
            print(f"Non-release conventional PR title detected ('{pr_title}'): Skipping release.")
            export_env("SKIP_RELEASE", "true")
            export_env("BUMP_TYPE", "none")
            return

        # Default for runtime changes without explicit version label is patch
        print("Runtime changes detected without explicit version label: Defaulting to patch bump.")
        export_env("BUMP_TYPE", "patch")
        export_env("SKIP_RELEASE", "false")
        return

    # Default for all other events (e.g. tag push)
    export_env("BUMP_TYPE", "none")

if __name__ == "__main__":
    main()
