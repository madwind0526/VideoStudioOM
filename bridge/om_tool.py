"""Runs one OpenMontage tool and prints exactly one JSON line on stdout.

Usage (run with OpenMontage's own venv python):
  om_tool.py --om-dir DIR list [--names a,b]
  om_tool.py --om-dir DIR --lock-file F --allow-root R [--allow-root R2] run TOOL   (input JSON on stdin)

Exit code is 0 whenever a JSON result was printed, even for "ok": false.
GPU tools (runtime local_gpu) take an exclusive lock file first; a busy lock is reported as code "busy"
instead of waiting, so the caller can answer 409 right away.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path

# A lock file that exists but cannot be parsed is usually being written right now.
LOCK_GRACE_SECONDS = 5


def pid_alive(pid: int) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    if os.name == "nt":
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        ok = kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        kernel32.CloseHandle(handle)
        return bool(ok) and code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def read_lock(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def acquire_lock(path: Path, info: dict) -> dict | None:
    """Takes the lock. Returns None on success, or the holder's info when it is busy.

    shortcut: stale-lock cleanup is check-then-delete, so two processes cleaning the same stale
    lock at the same instant can race; fine for one user on one PC, upgrade to a lock service if
    several machines ever share this file.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(3):
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            held = read_lock(path)
            if held is None:
                try:
                    young = time.time() - path.stat().st_mtime < LOCK_GRACE_SECONDS
                except FileNotFoundError:
                    continue
                if young:
                    return {"pid": 0, "tool": "unknown"}
            elif pid_alive(held.get("pid")):
                return held
            # Holder is gone (crashed or killed): the lock is stale.
            try:
                path.unlink()
            except FileNotFoundError:
                pass
            continue
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(info, handle, ensure_ascii=False)
        return None
    return read_lock(path) or {"pid": 0, "tool": "unknown"}


def release_lock(path: Path) -> None:
    held = read_lock(path)
    # Only remove our own lock; a stale-cleanup by someone else may have replaced it.
    if held and held.get("pid") == os.getpid():
        try:
            path.unlink()
        except FileNotFoundError:
            pass


def emit(out, payload: dict) -> None:
    out.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
    out.flush()


def outside_roots(inputs: dict, roots: list[Path]) -> str | None:
    """Returns the first path-like input that is not inside an allowed root."""
    def inside(value: str) -> bool:
        target = os.path.normcase(str(Path(value).resolve()))
        return any(target == r or target.startswith(r + os.sep) for r in (os.path.normcase(str(root)) for root in roots))

    for key, value in inputs.items():
        if key.endswith(("_path", "_dir")) and isinstance(value, str) and value:
            if not inside(value):
                return key
        elif key.endswith("_paths") and isinstance(value, list):
            if any(isinstance(item, str) and not inside(item) for item in value):
                return key
    return None


def result_payload(tool_name: str, result) -> dict:
    return {
        "ok": bool(result.success),
        "tool": tool_name,
        "data": result.data,
        "artifacts": result.artifacts,
        "error": result.error,
        "costUsd": result.cost_usd,
        "durationSeconds": result.duration_seconds,
        "seed": result.seed,
        "model": result.model,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--om-dir", required=True)
    parser.add_argument("--lock-file")
    parser.add_argument("--allow-root", action="append", default=[])
    sub = parser.add_subparsers(dest="command", required=True)
    list_cmd = sub.add_parser("list")
    list_cmd.add_argument("--names", default="")
    run_cmd = sub.add_parser("run")
    run_cmd.add_argument("tool")
    args = parser.parse_args()

    # Tools run ffmpeg and friends without capturing output, which would land in our stdout and
    # corrupt the JSON line. Keep the real stdout on a private fd and point fd 1 at stderr.
    out = os.fdopen(os.dup(1), "w", encoding="utf-8", newline="\n")
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    om_dir = Path(args.om_dir).resolve()
    os.chdir(om_dir)
    sys.path.insert(0, str(om_dir))
    try:
        from tools.base_tool import ToolRuntime, ToolStatus
        from tools.tool_registry import registry

        registry.discover()
    except Exception as exc:  # noqa: BLE001 - report any import problem to the caller
        traceback.print_exc()
        emit(out, {"ok": False, "code": "import_failed", "error": f"OpenMontage를 불러오지 못했습니다: {exc}"})
        return 0

    if args.command == "list":
        wanted = {name for name in args.names.split(",") if name}
        tools = []
        for name in registry.list_all():
            if wanted and name not in wanted:
                continue
            tool = registry.get(name)
            tools.append({
                "name": name,
                "status": tool.get_status().value,
                "capability": tool.capability,
                "runtime": tool.runtime.value,
                "inputSchema": tool.input_schema,
            })
        emit(out, {"ok": True, "tools": tools})
        return 0

    tool = registry.get(args.tool)
    if tool is None:
        emit(out, {"ok": False, "code": "unknown_tool", "error": f"도구를 찾을 수 없습니다: {args.tool}"})
        return 0
    try:
        inputs = json.loads(sys.stdin.buffer.read().decode("utf-8") or "null")
    except ValueError:
        inputs = None
    if not isinstance(inputs, dict):
        emit(out, {"ok": False, "code": "bad_input", "error": "입력은 JSON 객체여야 합니다."})
        return 0
    schema = tool.input_schema or {}
    try:
        import jsonschema
    except ImportError:
        jsonschema = None
    if schema and jsonschema is not None:
        try:
            jsonschema.validate(inputs, schema)
        except jsonschema.ValidationError as exc:
            emit(out, {"ok": False, "code": "bad_input", "error": f"입력이 올바르지 않습니다: {exc.message}"})
            return 0
    elif schema:
        # Without jsonschema (not the case in OpenMontage's venv) at least require the mandatory keys.
        missing = [key for key in schema.get("required", []) if key not in inputs]
        if missing:
            emit(out, {"ok": False, "code": "bad_input", "error": f"필수 입력이 없습니다: {', '.join(missing)}"})
            return 0

    roots = [Path(root).resolve() for root in args.allow_root]
    bad_key = outside_roots(inputs, roots) if roots else None
    if bad_key:
        emit(out, {"ok": False, "code": "path_outside", "error": f"허용된 폴더 밖의 경로입니다: {bad_key}"})
        return 0
    if tool.get_status() != ToolStatus.AVAILABLE:
        emit(out, {"ok": False, "code": "unavailable", "error": f"{args.tool}을(를) 지금 쓸 수 없습니다. 모델과 서비스 설치를 확인하세요."})
        return 0

    lock_path = None
    if tool.runtime == ToolRuntime.LOCAL_GPU:
        if not args.lock_file:
            emit(out, {"ok": False, "code": "lock_required", "error": "GPU 도구는 락 파일이 필요합니다."})
            return 0
        lock_path = Path(args.lock_file)
        held = acquire_lock(lock_path, {
            "pid": os.getpid(),
            "tool": args.tool,
            "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        })
        if held is not None:
            emit(out, {"ok": False, "code": "busy", "error": "GPU를 다른 작업이 쓰고 있습니다.", "lock": held})
            return 0

    try:
        result = tool.execute(inputs)
        emit(out, result_payload(args.tool, result))
    except Exception as exc:  # noqa: BLE001 - a tool crash must still produce a JSON answer
        traceback.print_exc()
        emit(out, {"ok": False, "code": "exception", "tool": args.tool, "error": f"{type(exc).__name__}: {exc}"})
    finally:
        if lock_path is not None:
            release_lock(lock_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
