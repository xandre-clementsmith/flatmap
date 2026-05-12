#!/usr/bin/env python3
"""
Look up Allen CCF structure IDs by acronym or name fragment.
Usage:
  python src/find_allen_id.py LH
  python src/find_allen_id.py "lateral habenula"
  python src/find_allen_id.py 186          # look up by ID
"""
import sys
from iblatlas.regions import BrainRegions

if len(sys.argv) < 2:
    print("Usage: python src/find_allen_id.py <acronym|name|id>")
    sys.exit(1)

query = sys.argv[1].strip()
br = BrainRegions()

results = []
if query.isdigit():
    sid = int(query)
    if sid in br.id:
        idx = list(br.id).index(sid)
        results.append((sid, br.acronym[idx], br.name[idx]))
else:
    q = query.lower()
    for i, (sid, acr, name) in enumerate(zip(br.id, br.acronym, br.name)):
        if q == acr.lower() or q in name.lower():
            results.append((sid, acr, name))

if not results:
    print(f"No results for '{query}'")
else:
    print(f"{'ID':>6}  {'Acronym':>12}  Name")
    for sid, acr, name in results:
        print(f"{sid:>6}  {acr:>12}  {name}")
