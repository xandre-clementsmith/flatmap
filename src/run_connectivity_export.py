#!/usr/bin/env python3
"""Runnable wrapper for the Phase 0 export script.

Open this file in VS Code and click Run to execute the export.
"""

from pathlib import Path
import sys

# Ensure the local src directory is on sys.path when running from VS Code
SRC_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SRC_DIR))

from export_phase0 import main

if __name__ == "__main__":
    main()
