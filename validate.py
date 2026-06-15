#!/usr/bin/env python3
"""
Validate an AURA activity bank against the C1 schema.
Usage:  python validate.py [activity_bank.json]   (defaults to activity_bank.seed.json)
Exit code 0 = all valid; 1 = errors found. This is the Day-1 gate eval for Dev 4.
"""
import json, sys

try:
    from jsonschema import Draft7Validator
except ImportError:
    sys.exit("Missing dependency. Run:  pip install jsonschema  (then re-run)")

schema = json.load(open("c1_activity.schema.json"))
bank_path = sys.argv[1] if len(sys.argv) > 1 else "activity_bank.seed.json"
data = json.load(open(bank_path))
nodes = data if isinstance(data, list) else data.get("nodes", [data])

validator = Draft7Validator(schema)
errors = 0
seen_ids = set()

for i, node in enumerate(nodes):
    aid = node.get("activity_id", "?")
    for e in validator.iter_errors(node):
        errors += 1
        print(f"[node {i} :: {aid}] {e.message}")
    if aid in seen_ids:
        errors += 1
        print(f"[node {i} :: {aid}] duplicate activity_id")
    seen_ids.add(aid)

print(f"\n{len(nodes)} node(s) checked, {errors} error(s).")
sys.exit(1 if errors else 0)
