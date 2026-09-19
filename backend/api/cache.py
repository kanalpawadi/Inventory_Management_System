"""
api/cache.py
Tiny mtime-aware cache for the precomputed parquet files. The files only change
when the ML pipeline is rerun, so re-reading them from disk on every request is
wasted CPU on a small free-tier instance.
"""

import os
from functools import lru_cache

import pandas as pd


@lru_cache(maxsize=16)
def _read(path: str, mtime: float) -> pd.DataFrame:
    return pd.read_parquet(path)


def read_parquet(path: str) -> pd.DataFrame:
    """Return a private copy so callers can mutate/filter freely."""
    return _read(path, os.path.getmtime(path)).copy()
