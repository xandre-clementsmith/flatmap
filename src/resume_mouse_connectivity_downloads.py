#!/usr/bin/env python3
"""Resume or inspect Allen mouse connectivity experiment downloads.

This script uses `mouse_connectivity/experiments.json` as the source of truth and
can optionally download missing files for incomplete experiment directories.
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Iterable

from allensdk.api.queries.mouse_connectivity_api import MouseConnectivityApi
from allensdk.core.mouse_connectivity_cache import MouseConnectivityCache

REQUIRED_BASE_FILES = {
    "structure_unionizes.csv",
    "alignment3d.json",
    "dfmfld.mhd",
    "dfmfld.raw",
}

GRID_DOWNLOAD_SPEC = [
    ("injection_density_{}.nrrd", "download_injection_density"),
    ("injection_fraction_{}.nrrd", "download_injection_fraction"),
    ("projection_density_{}.nrrd", "download_projection_density"),
    ("data_mask_{}.nrrd", "download_data_mask"),
]

DEFAULT_RESOLUTIONS = [25]


def get_repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def load_experiment_ids(experiments_json: Path) -> list[int]:
    with experiments_json.open("r", encoding="utf-8") as f:
        experiments = json.load(f)
    ids = [int(item["data_set_id"]) for item in experiments if "data_set_id" in item]
    return sorted(ids)


def scan_downloaded_experiments(mc_dir: Path) -> dict[int, Path]:
    experiments = {}
    for experiment_dir in sorted(mc_dir.glob("experiment_*")):
        if experiment_dir.is_dir():
            try:
                experiment_id = int(experiment_dir.name.split("_", 1)[1])
            except ValueError:
                continue
            experiments[experiment_id] = experiment_dir
    return experiments


def assess_experiment(experiment_dir: Path) -> dict[str, object]:
    files = [p.name for p in experiment_dir.iterdir() if p.is_file()]
    found = set(files)
    missing_required = sorted(REQUIRED_BASE_FILES - found)
    nrrd_count = sum(1 for name in files if name.endswith(".nrrd"))
    return {
        "files": sorted(files),
        "missing_required": missing_required,
        "nrrd_count": nrrd_count,
    }


def is_experiment_complete(experiment_dir: Path, resolutions: list[int]) -> bool:
    info = assess_experiment(experiment_dir)
    if info["missing_required"]:
        return False
    for template, _ in GRID_DOWNLOAD_SPEC:
        for res in resolutions:
            if not (experiment_dir / template.format(res)).exists():
                return False
    return True


def download_experiment(
    experiment_id: int,
    experiment_dir: Path,
    resolutions: list[int],
    dry_run: bool = False,
) -> dict[str, object]:
    cache = MouseConnectivityCache()
    api = MouseConnectivityApi()
    experiment_dir.mkdir(parents=True, exist_ok=True)
    downloaded_files: list[str] = []

    if dry_run:
        print(f"[DRY RUN] Would resume experiment {experiment_id} into {experiment_dir}")
        return {"experiment_id": experiment_id, "downloaded_files": [], "status": "dry_run"}

    if not (experiment_dir / "structure_unionizes.csv").exists():
        print(f"Downloading structure_unionizes.csv for {experiment_id}")
        cache.get_experiment_structure_unionizes(
            experiment_id,
            file_name=str(experiment_dir / "structure_unionizes.csv"),
        )
        downloaded_files.append("structure_unionizes.csv")

    alignment_path = experiment_dir / "alignment3d.json"
    if not alignment_path.exists():
        print(f"Downloading alignment3d.json for {experiment_id}")
        alignment = api.download_alignment3d(experiment_id)
        with alignment_path.open("w", encoding="utf-8") as f:
            json.dump(alignment, f, indent=2)
        downloaded_files.append("alignment3d.json")

    header_path = experiment_dir / "dfmfld.mhd"
    voxel_path = experiment_dir / "dfmfld.raw"
    if not header_path.exists() or not voxel_path.exists():
        print(f"Downloading deformation field for {experiment_id}")
        api.download_deformation_field(
            experiment_id,
            header_path=str(header_path),
            voxel_path=str(voxel_path),
        )
        downloaded_files.extend(["dfmfld.mhd", "dfmfld.raw"])

    for resolution in resolutions:
        for template, method_name in GRID_DOWNLOAD_SPEC:
            target_path = experiment_dir / template.format(resolution)
            if target_path.exists():
                continue
            print(f"Downloading {target_path.name} for {experiment_id}")
            method = getattr(api, method_name)
            method(str(target_path), experiment_id, resolution)
            downloaded_files.append(target_path.name)

    if downloaded_files:
        status = "updated"
    else:
        status = "already_complete"

    return {
        "experiment_id": experiment_id,
        "downloaded_files": downloaded_files,
        "status": status,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Resume Allen mouse connectivity experiment downloads."
    )
    parser.add_argument(
        "--download",
        action="store_true",
        help="Attempt to download missing files for incomplete experiments.",
    )
    parser.add_argument(
        "--experiment-id",
        type=int,
        nargs="*",
        default=None,
        help="Specific experiment IDs to resume. If omitted, resume all missing/incomplete experiments.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of experiments to resume in one run.",
    )
    parser.add_argument(
        "--resolutions",
        type=int,
        nargs="*",
        default=DEFAULT_RESOLUTIONS,
        help="Grid resolutions to download (default: 25). Pass e.g. 10 25 50 100.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be downloaded without making network calls.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    repo_root = get_repo_root()
    mc_dir = repo_root / "mouse_connectivity"
    experiments_json = mc_dir / "experiments.json"

    if not mc_dir.exists() or not mc_dir.is_dir():
        raise FileNotFoundError(f"mouse_connectivity directory not found at {mc_dir}")
    if not experiments_json.exists():
        raise FileNotFoundError(f"experiments.json not found at {experiments_json}")

    expected_ids = load_experiment_ids(experiments_json)
    downloaded = scan_downloaded_experiments(mc_dir)
    downloaded_ids = sorted(downloaded)

    missing_ids = [eid for eid in expected_ids if eid not in downloaded]
    partial_ids = [eid for eid in downloaded_ids if not is_experiment_complete(downloaded[eid], args.resolutions)]

    print(f"Total experiment IDs in experiments.json: {len(expected_ids)}")
    print(f"Downloaded experiment directories: {len(downloaded_ids)}")
    print(f"Missing experiment directories: {len(missing_ids)}")
    print(f"Incomplete experiment directories: {len(partial_ids)}")
    print()

    if missing_ids:
        print("Missing experiment IDs (first 20):")
        print(", ".join(str(x) for x in missing_ids[:20]))
        print()

    if partial_ids:
        print("Incomplete experiment IDs (first 20):")
        print(", ".join(str(x) for x in partial_ids[:20]))
        print()

    if not args.download:
        print("Run with --download to resume missing/incomplete experiment downloads.")
        return

    to_resume: list[int] = []
    if args.experiment_id:
        for eid in args.experiment_id:
            if eid in expected_ids:
                to_resume.append(eid)
            else:
                print(f"Warning: experiment {eid} is not present in experiments.json and will be skipped.")
    else:
        to_resume = sorted(set(missing_ids + partial_ids))

    if args.limit is not None:
        to_resume = to_resume[: args.limit]

    if not to_resume:
        print("No experiments to resume.")
        return

    print(f"Resuming {len(to_resume)} experiment(s): {to_resume[:10]}{'' if len(to_resume)<=10 else '...'}")

    completed: list[dict[str, object]] = []
    errors: list[tuple[int, str]] = []

    for experiment_id in to_resume:
        try:
            result = download_experiment(
                experiment_id,
                mc_dir / f"experiment_{experiment_id}",
                args.resolutions,
                dry_run=args.dry_run,
            )
            completed.append(result)
            if result["status"] == "updated":
                print(
                    f"Experiment {experiment_id} updated with {len(result['downloaded_files'])} new file(s)."
                )
            elif result["status"] == "already_complete":
                print(f"Experiment {experiment_id} was already complete.")
            elif result["status"] == "dry_run":
                print(f"Dry run: experiment {experiment_id} would be resumed.")
        except Exception as exc:
            errors.append((experiment_id, str(exc)))
            print(f"ERROR downloading {experiment_id}: {exc}")
            continue

    print()
    print("Resume run complete.")
    print(f"Experiments processed: {len(completed)}")
    print(f"Successful: {len(completed) - len(errors)}")
    print(f"Failed: {len(errors)}")
    if errors:
        print("Failed experiment IDs:")
        print(", ".join(str(eid) for eid, _ in errors))


if __name__ == "__main__":
    main()
