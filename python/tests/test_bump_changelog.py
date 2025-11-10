import io
import os
from typing import List, Tuple

import pytest


import python.bump_changelog as bc


def write_changelog(path: str, lines: List[str]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


@pytest.mark.parametrize(
    "part,expected",
    [
        ("patch", "1.2.4"),
        ("minor", "1.3.0"),
        ("major", "2.0.0"),
    ],
)
def test_bump_version_variants(part: str, expected: str):
    assert bc.bump_version("1.2.3", part, pre=None) == expected
    assert bc.bump_version("1.2.3", part, pre="rc1").endswith("-rc1")


def test_extract_current_version_happy_path():
    lines = [
        "# 1.2.3 - 2024-01-01",
        "",
        "rest...",
    ]
    assert bc.extract_current_version(lines) == "1.2.3"


def test_extract_current_version_missing_returns_none():
    lines = [
        "# Changelog",
        "",
        "# 1.2.3 - later heading should be ignored",
    ]
    assert bc.extract_current_version(lines) is None


def test_gather_unreleased_captures_and_strips_section():
    orig = [
        "# 1.2.3 - 2024-01-01",
        "",
        "(Unreleased)",
        "- fix A",
        "- add B",
        "",
        "# 1.2.2 - 2023-12-01",
        "body",
    ]
    captured, new_lines = bc.gather_unreleased(orig)
    assert captured == ["- fix A", "- add B"]
    assert "(Unreleased)" not in "\n".join(new_lines)
    assert "- fix A" not in "\n".join(new_lines)


def test_main_patch_dry_run_moves_unreleased_and_increments(tmp_path, capsys, monkeypatch):
    changelog = tmp_path / "CHANGELOG.md"
    lines = [
        "# 1.2.3 - 2024-01-01",
        "",
        "(unreleased)",
        "- fix one",
        "- add two",
        "",
        "# 1.2.2 - 2023-12-01",
        "older",
    ]
    write_changelog(str(changelog), lines)

    monkeypatch.setattr(bc, "CHANGELOG_PATH", str(changelog))

    code = bc.main(["--part", "patch", "--dry-run", "--date", "2025-01-02"])
    assert code == 0
    out = capsys.readouterr().out
    assert "# 1.2.4 - 2025-01-02" in out
    assert "Changes:" in out
    assert "- fix one" in out and "- add two" in out
    assert "(unreleased)" not in out


@pytest.mark.parametrize("no_placeholder", [False, True])
def test_main_minor_placeholder_toggle(tmp_path, capsys, monkeypatch, no_placeholder: bool):
    changelog = tmp_path / "CHANGELOG.md"
    lines = [
        "# 2.0.0 - 2024-01-01",
        "",
        "Some body",
    ]
    write_changelog(str(changelog), lines)
    monkeypatch.setattr(bc, "CHANGELOG_PATH", str(changelog))

    args = ["--part", "minor", "--dry-run", "--date", "2025-01-05"]
    if no_placeholder:
        args.append("--no-placeholder")
    code = bc.main(args)
    assert code == 0
    out = capsys.readouterr().out
    assert "# 2.1.0 - 2025-01-05" in out
    if no_placeholder:
        assert "Added:" not in out
        assert "(placeholder)" not in out
    else:
        assert "Added:" in out and "(placeholder)" in out


def test_main_set_with_pre_and_build_metadata(tmp_path, capsys, monkeypatch):
    changelog = tmp_path / "CHANGELOG.md"
    write_changelog(str(changelog), ["# 1.2.3 - 2024-01-01", "", "body"])
    monkeypatch.setattr(bc, "CHANGELOG_PATH", str(changelog))

    code = bc.main(["--set", "3.0.0+exp.sha", "--pre", "rc1", "--dry-run", "--date", "2025-02-10"])
    assert code == 0
    out = capsys.readouterr().out
    assert "# 3.0.0-rc1+exp.sha - 2025-02-10" in out


def test_main_error_when_no_detected_version_and_no_set(tmp_path, capsys, monkeypatch):
    changelog = tmp_path / "CHANGELOG.md"
    write_changelog(str(changelog), ["# Changelog", "", "body"])
    monkeypatch.setattr(bc, "CHANGELOG_PATH", str(changelog))

    code = bc.main([])
    assert code == 2
    err = capsys.readouterr().err
    assert "Could not detect current version" in err


def test_main_write_and_git_commit_tag_flow(tmp_path, capsys, monkeypatch):
    # Arrange changelog
    changelog = tmp_path / "CHANGELOG.md"
    write_changelog(str(changelog), ["# 0.1.0 - 2024-01-01", "", "body"])
    monkeypatch.setattr(bc, "CHANGELOG_PATH", str(changelog))

    # Point ROOT to a temp dir so relpath looks sane
    monkeypatch.setattr(bc, "ROOT", str(tmp_path))

    # Fake git pipeline: add ok, commit ok, rev-parse non-zero (tag does not exist), tag ok
    calls: List[Tuple[List[str],]] = []

    def fake_git_run(args):
        calls.append((args,))
        if args[:2] == ["git", "rev-parse"]:
            return 1, "not found"
        return 0, "ok"

    monkeypatch.setattr(bc, "git_run", fake_git_run)

    code = bc.main(["--part", "patch", "--commit", "--tag", "--date", "2025-03-01"])
    assert code == 0
    out = capsys.readouterr().out
    assert "CHANGELOG bumped: 0.1.0 -> 0.1.1" in out
    # File should be updated (not dry-run)
    content = read_text(str(changelog))
    assert content.splitlines()[0].startswith("# 0.1.1 - 2025-03-01")


def test_main_git_tag_exists_requires_force(tmp_path, capsys, monkeypatch):
    changelog = tmp_path / "CHANGELOG.md"
    write_changelog(str(changelog), ["# 1.0.0 - 2024-01-01", "", "body"])
    monkeypatch.setattr(bc, "CHANGELOG_PATH", str(changelog))
    monkeypatch.setattr(bc, "ROOT", str(tmp_path))

    def fake_git_run(args):
        if args[:2] == ["git", "rev-parse"]:
            return 0, "exists"
        return 0, "ok"

    monkeypatch.setattr(bc, "git_run", fake_git_run)
    code = bc.main(["--part", "patch", "--commit", "--tag", "--date", "2025-04-10"])
    assert code == 3
    out = capsys.readouterr().out
    assert "ERROR: tag v1.0.1 already exists" in out
