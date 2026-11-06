"""Second-seat Glimmer vLLM host on Modal.

Deploy with `python3 -m modal deploy infra/modal/glimmer_app.py`, stop with
`python3 -m modal app stop second-seat-glimmer`. Scale-to-zero.

Live eval with `GLIMMER_EVAL_DATASET=<dataset> python3 -m modal run
--detach infra/modal/glimmer_app.py --dataset <dataset> --config <config>`
(ephemeral app, stops when done; build services/bot first).
"""

import datetime
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import launch_contract

import modal

app = modal.App("second-seat-glimmer")

volume = modal.Volume.from_name("glimmer-weights", create_if_missing=True)
results = modal.Volume.from_name("glimmer-results", create_if_missing=True)

_here = Path(__file__).resolve()
_repo = _here.parents[2] if len(_here.parents) > 2 else Path("/")  # driver: container path is shallow

# Testable roots: every /results path, the bot cwd, and the vLLM base URL go
# through these module constants instead of literals so tests can point them
# at tmp dirs on the imported module.
_RESULTS_ROOT = "/results"
_BOT_DIR = "/app/services/bot"
_VLLM_BASE_URL = "http://127.0.0.1:8000"

def _sha256_hex(data):
    return hashlib.sha256(data).hexdigest()


def _read_launcher_identity():
    """sha256 over glimmer_app.py bytes + launch_contract.py bytes."""
    try:
        with open(_here, "rb") as _fh:
            _app_bytes = _fh.read()
        with open(_here.parent / "launch_contract.py", "rb") as _fh:
            _contract_bytes = _fh.read()
        return _sha256_hex(_app_bytes + _contract_bytes)
    except Exception:
        return None


# Launch config baked into the images: the raw bytes are read exactly once
# at import. _LAUNCH_CONFIG is the canonical nested run config parsed from
# those same bytes and _LAUNCH_CONFIG_SHA256 identifies them; main()
# re-reads the file and refuses when the bytes (not just the path) changed
# since import. _LAUNCH_PROJECTION is the explicit bound flat projection
# computed from the canonical config; _MODEL_REVISION/_LAUNCH_IMAGE come
# from the projection (empty when the projection fails).
# Inside the deployed container GLIMMER_LAUNCH_CONFIG is unset (Modal does not
# forward the deployer's env), so the same bytes are shipped next to this
# file by _with_launch_files() and picked up from there.
_CONTAINER_ROOT = "/root"
_CONFIG_BASENAME = "glimmer-launch-config.json"
_LAUNCH_CONFIG_PATH = os.environ.get("GLIMMER_LAUNCH_CONFIG", "")
if not _LAUNCH_CONFIG_PATH and (_here.parent / _CONFIG_BASENAME).is_file():
    _LAUNCH_CONFIG_PATH = str(_here.parent / _CONFIG_BASENAME)
_LAUNCH_CONFIG = {}
_LAUNCH_CONFIG_BYTES = None
_LAUNCH_CONFIG_SHA256 = None
_LAUNCH_PROJECTION = None
_LAUNCH_PROJECTION_ERRORS = ["launch config missing: GLIMMER_LAUNCH_CONFIG is unset"]
if _LAUNCH_CONFIG_PATH:
    try:
        with open(_LAUNCH_CONFIG_PATH, "rb") as _fh:
            _LAUNCH_CONFIG_BYTES = _fh.read()
        _LAUNCH_CONFIG_SHA256 = _sha256_hex(_LAUNCH_CONFIG_BYTES)
        _parsed = json.loads(_LAUNCH_CONFIG_BYTES.decode("utf-8"))
        _LAUNCH_CONFIG = _parsed if isinstance(_parsed, dict) else {}
        _LAUNCH_PROJECTION, _LAUNCH_PROJECTION_ERRORS = launch_contract.project_launch(_LAUNCH_CONFIG)
    except Exception:
        _LAUNCH_CONFIG = {}
        _LAUNCH_CONFIG_BYTES = None
        _LAUNCH_CONFIG_SHA256 = None
        _LAUNCH_PROJECTION = None
        _LAUNCH_PROJECTION_ERRORS = ["launch config unreadable: cannot parse GLIMMER_LAUNCH_CONFIG bytes"]
if isinstance(_LAUNCH_PROJECTION, dict):
    _proj_model_revision = _LAUNCH_PROJECTION.get("model_revision", "")
    _proj_image = _LAUNCH_PROJECTION.get("image", "")
    _MODEL_REVISION = _proj_model_revision if isinstance(_proj_model_revision, str) else ""
    _LAUNCH_IMAGE = _proj_image if isinstance(_proj_image, str) else ""
else:
    _MODEL_REVISION = ""
    _LAUNCH_IMAGE = ""

# Frozen function/readiness settings from the canonical config staged at
# import. The eval Modal function timeout and the readiness work budget come
# from timeouts.functionTimeoutS / timeouts.workDeadlineS, never from
# literals. The 840/780 literals below are only the no-config fallback when
# no launch config was staged at import.
_FUNCTION_TIMEOUT_S = 840
_WORK_BUDGET_S = 780
_FUNCTION_SETTINGS_ERRORS = []
if _LAUNCH_CONFIG_BYTES is not None:
    try:
        _fs, _fs_errs = launch_contract.function_settings(_LAUNCH_CONFIG)
        _FUNCTION_SETTINGS_ERRORS = list(_fs_errs)
        _ft = _fs.get("function_timeout_s")
        _wb = _fs.get("work_budget_s")
        if (
            isinstance(_ft, bool)
            or not isinstance(_ft, (int, float))
            or not (_ft > 0)
            or isinstance(_wb, bool)
            or not isinstance(_wb, (int, float))
            or not (_wb > 0)
        ):
            raise ValueError("frozen timeouts missing or not positive")
        _FUNCTION_TIMEOUT_S = _ft
        _WORK_BUDGET_S = _wb
    except Exception:
        _FUNCTION_TIMEOUT_S = 840
        _WORK_BUDGET_S = 780
        _FUNCTION_SETTINGS_ERRORS = ["function settings unreadable: cannot derive frozen timeouts"]

# Launcher identity at import; main() recomputes it and refuses on drift.
_LAUNCHER_SHA256 = _read_launcher_identity()

# Latest main() outcome: None until a launch passes every gate (refused
# attempts reset it to None instead of leaving a stale record).
_LAST_LAUNCH_RECORD = None

# Dataset baked into the eval image, read at import. When unset the eval
# image carries no eval fixtures; when set it is built via package_dirs.
_EVAL_DATASET = os.environ.get("GLIMMER_EVAL_DATASET", "")

if _LAUNCH_IMAGE:
    image = (
        modal.Image.from_registry(_LAUNCH_IMAGE)
        .dockerfile_commands(["RUN ln -sf \"$(command -v python3)\" /usr/local/bin/python"])
        .entrypoint([])
    )
    # Derive from `image` (not the raw registry image) so eval_in_container
    # also gets the python symlink and empty entrypoint Modal needs to detect
    # the Python version; otherwise `modal deploy` fails for that Function.
    _node_base = image.run_commands("apt-get update && apt-get install -y curl ca-certificates && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs && node --version")  # driver: distro nodejs too old for fetch
else:
    image = (
        modal.Image.from_registry("vllm/vllm-openai:muse-glimmer")
        .dockerfile_commands(["RUN ln -sf \"$(command -v python3)\" /usr/local/bin/python"])
        .entrypoint([])
    )
    _node_base = image.run_commands("apt-get update && apt-get install -y curl ca-certificates && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs && node --version")  # driver: distro nodejs too old for fetch

if _EVAL_DATASET:
    eval_in_container_image = _node_base
    for _local, _remote in launch_contract.package_dirs(str(_repo), _EVAL_DATASET):
        eval_in_container_image = eval_in_container_image.add_local_dir(_local, _remote)
    eval_in_container_image = eval_in_container_image.add_local_file(
        str(_repo / "services/bot/package.json"), "/app/services/bot/package.json"
    )
else:
    eval_in_container_image = (
        _node_base
        .add_local_dir(str(_repo / "services/bot/dist"), "/app/services/bot/dist")
        .add_local_dir(str(_repo / "services/bot/scripts"), "/app/services/bot/scripts")
        .add_local_file(
            str(_repo / "services/bot/package.json"), "/app/services/bot/package.json"
        )
    )


def _with_launch_files(img):
    """Ship launch_contract.py and the frozen launch-config bytes into the
    container (Modal 1.x mounts only the entrypoint file, and local env vars
    are not forwarded). Added last: add_local_file without copy=True must
    follow every build step. No config staged -> nothing shipped."""
    img = img.add_local_file(
        str(_here.parent / "launch_contract.py"), f"{_CONTAINER_ROOT}/launch_contract.py"
    )
    if _LAUNCH_CONFIG_BYTES is not None:
        img = img.add_local_file(_LAUNCH_CONFIG_PATH, f"{_CONTAINER_ROOT}/{_CONFIG_BASENAME}")
    return img


@app.function(
    image=_with_launch_files(image),
    gpu="A100-80GB",
    volumes={"/root/.cache/huggingface": volume},
    timeout=3600,
    scaledown_window=300,
    max_containers=1,
)
@modal.concurrent(max_inputs=16)
@modal.web_server(port=8000, startup_timeout=1500)
def serve() -> None:
    # vLLM flags come from the frozen launch config via the pure contract
    # builder (revision + token-limit derived, never hardcoded here).
    _argv = launch_contract.vllm_argv(_LAUNCH_CONFIG)
    if not _LAUNCH_CONFIG_BYTES or not _argv[_argv.index("--revision") + 1]:
        raise RuntimeError(
            "launch config missing in container: refusing to start vLLM without a pinned revision"
        )
    cmd = launch_contract.vllm_argv(_LAUNCH_CONFIG, host="0.0.0.0", port=8000)
    subprocess.Popen(cmd)


# NOTE: single_use_containers=True is intentionally omitted: it is unclear
# whether this Modal version accepts that kwarg, and an unknown kwarg would
# fail app definition at import time.
@app.function(
    image=_with_launch_files(eval_in_container_image),
    gpu="A100-80GB",
    volumes={"/root/.cache/huggingface": volume, "/results": results},
    timeout=_FUNCTION_TIMEOUT_S,
    max_containers=1,
    retries=0,
)
def eval_in_container(dataset: str, config_sha256: str) -> dict:
    func_start = time.monotonic()
    # Identity gate first: the eval runs only when the frozen launch-config
    # bytes are present and their sha256 equals the bound config_sha256.
    # Otherwise an explicit error is recorded and the eval does NOT run
    # (no unconfigured fallback).
    identity_error = None
    if not _LAUNCH_CONFIG_BYTES:
        identity_error = "run config missing: no frozen launch config bytes staged at import (refusing unconfigured eval)"
    elif not isinstance(config_sha256, str) or config_sha256 == "" or _sha256_hex(_LAUNCH_CONFIG_BYTES) != config_sha256:
        identity_error = (
            f"run config identity mismatch: config_sha256 {config_sha256!r} != "
            "sha256(frozen launch config bytes) (refusing)"
        )
    if identity_error is not None:
        result = {
            "health": None,
            "seconds_to_healthy": None,
            "eval_returncode": None,
            "eval_stdout": "",
            "eval_stderr": identity_error[-2000:],
            "ran_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "run_id": None,
        }
        live_eval_path = Path(os.path.join(_RESULTS_ROOT, "glimmer-live-eval.json"))
        live_eval_path.parent.mkdir(parents=True, exist_ok=True)
        live_eval_path.write_text(json.dumps(result, indent=2))
        try:
            results.commit()
        except Exception:
            pass
        print("GLIMMER_RESULT_JSON " + json.dumps(result))
        return result
    # Same contract builder as serve(): the frozen config's revision and
    # token limit drive the server, never hardcoded values.
    cmd = launch_contract.vllm_argv(_LAUNCH_CONFIG, host="127.0.0.1", port=8000)
    health_url = _VLLM_BASE_URL + "/health"
    base_url = _VLLM_BASE_URL
    # One unique run id per run. The frozen bytes are staged OUTSIDE the run
    # dir at <_RESULTS_ROOT>/.staging/<run_id>/run-config.json: staging
    # inside the run dir would create the directory the eval refuses to
    # reuse. A pre-existing run dir or staging dir refuses the run before
    # anything starts, and nothing is written into the existing run dir.
    run_id = (
        "run-"
        + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S")
        + f"-{os.getpid()}"
    )
    run_dir = os.path.join(_RESULTS_ROOT, run_id)
    staging_dir = os.path.join(_RESULTS_ROOT, ".staging", run_id)
    run_config_path = os.path.join(staging_dir, "run-config.json")
    staged_here = False
    reuse_error = None
    staging_error = None
    if os.path.exists(run_dir) or os.path.exists(staging_dir):
        reuse_error = (
            f"run dir reuse refused (refusing reuse): {run_id} already "
            f"exists under {_RESULTS_ROOT} (refusing)"
        )
    else:
        try:
            os.makedirs(staging_dir, exist_ok=False)
            staged_here = True
            with open(run_config_path, "wb") as _fh:
                _fh.write(_LAUNCH_CONFIG_BYTES)
        except FileExistsError:
            staged_here = False
            reuse_error = (
                f"run dir reuse refused (refusing reuse): staging dir "
                f"{staging_dir} already exists (refusing)"
            )
        except OSError as exc:
            # Fail closed: creating the staging dir or writing the frozen
            # config failed. Remove only the staging dir this call created
            # and report a staging failure (distinct from reuse refusal).
            # vLLM and the eval never start.
            staging_error = f"staging failed: cannot stage frozen config for {run_id} ({exc})"
            if staged_here:
                shutil.rmtree(staging_dir, ignore_errors=True)
                staged_here = False
    if staging_error is not None:
        result = {
            "health": None,
            "seconds_to_healthy": None,
            "eval_returncode": None,
            "eval_stdout": "",
            "eval_stderr": staging_error[-2000:],
            "ran_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "run_id": None,
        }
        live_eval_path = Path(os.path.join(_RESULTS_ROOT, "glimmer-live-eval.json"))
        try:
            live_eval_path.parent.mkdir(parents=True, exist_ok=True)
            live_eval_path.write_text(json.dumps(result, indent=2))
        except Exception:
            pass
        try:
            results.commit()
        except Exception:
            pass
        print("GLIMMER_RESULT_JSON " + json.dumps(result))
        return result
    if reuse_error is not None:
        result = {
            "health": None,
            "seconds_to_healthy": None,
            "eval_returncode": None,
            "eval_stdout": "",
            "eval_stderr": reuse_error[-2000:],
            "ran_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "run_id": None,
        }
        live_eval_path = Path(os.path.join(_RESULTS_ROOT, "glimmer-live-eval.json"))
        live_eval_path.parent.mkdir(parents=True, exist_ok=True)
        live_eval_path.write_text(json.dumps(result, indent=2))
        try:
            results.commit()
        except Exception:
            pass
        print("GLIMMER_RESULT_JSON " + json.dumps(result))
        return result
    # Own process group so the whole vLLM tree can be signalled on teardown.
    vllm = subprocess.Popen(cmd, start_new_session=True)
    health_status = None
    seconds_to_healthy = None
    eval_returncode = None
    eval_stdout = ""
    eval_stderr = ""
    try:
        def _probe():
            try:
                with urllib.request.urlopen(health_url, timeout=10) as resp:
                    return resp.status
            except Exception:
                return None

        # Model load and the readiness wait run INSIDE the frozen work
        # budget: they consume it.
        timing = launch_contract.wait_ready(
            time.monotonic, time.sleep, _probe, func_start, work_budget_s=_WORK_BUDGET_S
        )
        if timing["ready"]:
            seconds_to_healthy = time.monotonic() - func_start
            health_status = 200
        if not timing["ready"]:
            eval_stderr = "vllm not healthy within 300s; skipping eval"
        else:
            remaining_ms = timing["remaining_ms"]
            remaining_s = timing["remaining_s"]
            if remaining_ms <= 0 or remaining_s <= 0:
                eval_stderr = "no time remaining for eval"
            else:
                # The run dir is created exclusively by the eval itself; the
                # frozen config reaches it via the staging path outside the
                # run dir (staged above) plus the run's own config evidence.
                node_cmd = launch_contract.eval_command(
                    dataset, _RESULTS_ROOT, run_id, run_config_path, config_sha256
                )
                env = {
                    **os.environ,
                    "GLIMMER_BASE_URL": base_url,
                    "GLIMMER_DEADLINE_MS": str(remaining_ms),
                }
                try:
                    proc = subprocess.run(
                        node_cmd,
                        cwd=_BOT_DIR,
                        env=env,
                        capture_output=True,
                        text=True,
                        timeout=remaining_s,
                    )
                    eval_returncode = proc.returncode
                    eval_stdout = proc.stdout
                    eval_stderr = proc.stderr[-2000:]
                except subprocess.TimeoutExpired as exc:
                    eval_stderr = f"eval timed out: {exc}"
    finally:
        # Remove only the staging dir this call created, whatever happened.
        if staged_here:
            shutil.rmtree(staging_dir, ignore_errors=True)
        result = {
            "health": health_status,
            "seconds_to_healthy": seconds_to_healthy,
            "eval_returncode": eval_returncode,
            "eval_stdout": eval_stdout,
            "eval_stderr": eval_stderr,
            "ran_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "run_id": run_id if health_status == 200 else None,
        }
        live_eval_path = (
            Path(os.path.join(_RESULTS_ROOT, result["run_id"], "glimmer-live-eval.json"))
            if result["run_id"]
            else Path(os.path.join(_RESULTS_ROOT, "glimmer-live-eval.json"))
        )
        # Tear down the vLLM process group FIRST so a failing evidence
        # write cannot strand it; the evidence write then runs in its own
        # try and a failure stays visible via evidence_write_error.
        try:
            if vllm.poll() is None:
                os.killpg(vllm.pid, signal.SIGTERM)
                try:
                    vllm.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(vllm.pid, signal.SIGKILL)
        finally:
            evidence_error = None
            try:
                live_eval_path.parent.mkdir(parents=True, exist_ok=True)
                live_eval_path.write_text(json.dumps(result, indent=2))
            except Exception as exc:
                evidence_error = exc
                result["evidence_write_error"] = str(exc)[:500]
            try:
                results.commit()
            except Exception:
                pass
            print("GLIMMER_RESULT_JSON " + json.dumps(result))
            if evidence_error is not None:
                raise evidence_error
    print("GLIMMER_RESULT_JSON " + json.dumps(result))
    return result


@app.local_entrypoint()
def main(dataset: str = "", config: str = "") -> None:
    global _LAST_LAUNCH_RECORD
    _LAST_LAUNCH_RECORD = None
    env_dataset = os.environ.get("GLIMMER_EVAL_DATASET", "")
    env_config = os.environ.get("GLIMMER_LAUNCH_CONFIG", "")
    cfg = {}
    cfg_sha256 = None
    config_read_error = None
    if config:
        try:
            with open(config, "rb") as fh:
                cfg_bytes = fh.read()
            cfg_sha256 = _sha256_hex(cfg_bytes)
            cfg = json.loads(cfg_bytes.decode("utf-8"))
        except Exception as exc:
            config_read_error = f"launch config unreadable: {config!r} ({exc})"
    fixtures_root = str(_repo / "services" / "bot" / "fixtures")
    blockers = []
    if not env_config:
        blockers.append("launch config missing: GLIMMER_LAUNCH_CONFIG is unset")
    elif not config:
        blockers.append("launch config missing: --config is empty")
    else:
        try:
            if os.path.realpath(env_config) != os.path.realpath(config):
                blockers.append(
                    f"launch config mismatch: GLIMMER_LAUNCH_CONFIG {env_config!r} != --config {config!r}"
                )
        except Exception as exc:
            blockers.append(f"launch config mismatch: cannot compare config paths ({exc})")
        # Path equality is not enough: the bytes themselves must match what
        # was loaded at import. An alias path with identical bytes is
        # accepted; changed bytes are refused with zero spawns.
        if config_read_error is not None:
            blockers.append(config_read_error)
        elif _LAUNCH_CONFIG_SHA256 is None:
            blockers.append("launch config drift: no launch config was loaded at import")
        elif cfg_sha256 != _LAUNCH_CONFIG_SHA256:
            blockers.append("launch config drift: --config bytes changed since import (refusing)")
    # Launcher drift refuses too: the shipped code must be the imported code.
    launcher_sha256 = _read_launcher_identity()
    if launcher_sha256 is None or launcher_sha256 != _LAUNCHER_SHA256:
        blockers.append("launcher drift: glimmer_app.py/launch_contract.py bytes changed since import (refusing)")
    # The canonical nested config projects to the explicit flat launch
    # dict; projection errors are blockers and every downstream gate runs
    # on the projection, never on the raw dict.
    try:
        projection, projection_errors = launch_contract.project_launch(cfg)
    except Exception as exc:
        projection, projection_errors = None, [f"projection: cannot project launch config ({exc})"]
    blockers = blockers + list(projection_errors)
    # Frozen function/readiness settings: unsupported dynamic Modal settings
    # are rejected here, not merely recorded.
    try:
        _fs_settings, _fs_errors = launch_contract.function_settings(
            cfg if isinstance(cfg, dict) else {}
        )
    except Exception as exc:
        _fs_settings, _fs_errors = {}, [f"function settings unavailable: cannot derive frozen timeouts ({exc})"]
    blockers = blockers + list(_fs_errors)
    launch_cfg = projection if isinstance(projection, dict) else cfg
    blockers = blockers + launch_contract.check_launch(
        launch_cfg, fixtures_root, invoked_dataset=dataset, repo_root=str(_repo)
    )
    if isinstance(projection, dict):
        if dataset != projection.get("dataset"):
            blockers.append(
                f"dataset mismatch: invoked {dataset!r} != projected {projection.get('dataset')!r}"
            )
        if env_dataset != projection.get("dataset"):
            blockers.append(
                f"dataset mismatch: GLIMMER_EVAL_DATASET {env_dataset!r} != projected {projection.get('dataset')!r}"
            )
    # Git binding: the launch is bound to the recorded commit. HEAD must
    # equal the frozen source_sha and the working tree must hold no tracked
    # modifications and no untracked files besides the --config file itself
    # (both its literal repo-relative path, so alias paths stay accepted,
    # and its realpath-relative path). Any leftover refuses with zero
    # spawns.
    try:
        _real_repo = os.path.realpath(str(_repo))
        _cfg_paths = (
            [os.path.relpath(os.path.abspath(config), _real_repo)]
            if config
            else []
        )
        if config:
            _cfg_paths.append(os.path.relpath(os.path.realpath(config), _real_repo))
    except Exception:
        _cfg_paths = []
    _frozen_sha = launch_cfg.get("source_sha") if isinstance(launch_cfg, dict) else None
    blockers = blockers + launch_contract.git_binding_blockers(
        str(_repo), _frozen_sha, allow_untracked=tuple(_cfg_paths)
    )
    if dataset != env_dataset:
        blockers = [
            f"dataset mismatch: invoked {dataset!r} != GLIMMER_EVAL_DATASET {env_dataset!r}"
        ] + blockers
    if blockers:
        for b in blockers:
            print(f"BLOCKED: {b}")
        raise SystemExit(2)
    _LAST_LAUNCH_RECORD = {
        "dataset": dataset,
        "config": config,
        "config_sha256": cfg_sha256,
        "projection": projection,
        "projection_sha256": _sha256_hex(
            json.dumps(projection, sort_keys=True).encode("utf-8")
        ),
        "launcher_sha256": _LAUNCHER_SHA256,
        "image": _LAUNCH_IMAGE,
        "model_revision": _MODEL_REVISION,
        "function_settings": _fs_settings,
    }
    print("LAUNCH_RECORD " + json.dumps(_LAST_LAUNCH_RECORD, sort_keys=True))
    call = eval_in_container.spawn(dataset, cfg_sha256)
    print("CALL_ID " + call.object_id)
    return None


@app.local_entrypoint()
def fetch(run_id: str = "") -> None:
    if not run_id:
        print("run_id is required", file=sys.stderr)
        raise SystemExit(2)
    out_dir = (
        Path(__file__).resolve().parents[2] / "services/bot/fixtures/glimmer-run" / run_id
    )

    def list_files(rid):
        return launch_contract.rels_from_entries(list(results.listdir(rid, recursive=True)), rid)

    def read_file(remote):
        return b"".join(results.read_file(remote))

    launch_contract.download_run(list_files, read_file, run_id, str(out_dir))
    print(f"downloaded {run_id} -> {out_dir}")
