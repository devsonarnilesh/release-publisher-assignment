import csv
import re
import subprocess
from pathlib import Path

import duckdb

ROOT = Path("/app")

def run_report():
    result = subprocess.run(
        ["npm", "run", "--silent", "report"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, (
        f"npm run report failed\n\n"
        f"STDOUT:\n{result.stdout}\n\n"
        f"STDERR:\n{result.stderr}"
    )

    return result.stdout


def mask_receipts(text):
    return re.sub(r"RECEIPT=[^ ]+", "RECEIPT=<id>", text)


def expected_publishable_bundle_count():
    manifest = ROOT / "fixtures" / "build_manifest.csv"

    with open(manifest, newline="") as f:
        rows = list(csv.DictReader(f))

    # Remove exact duplicate rows
    unique_rows = []
    seen = set()

    for row in rows:
        key = tuple(sorted(row.items()))
        if key not in seen:
            seen.add(key)
            unique_rows.append(row)

    # Remove withdrawn builds
    withdrawn = {
        row["supersedes_id"]
        for row in unique_rows
        if row["record_type"] == "WITHDRAWAL"
    }

    surviving = [
        row
        for row in unique_rows
        if row["record_type"] == "BUILD"
        and row["entry_id"] not in withdrawn
    ]

    return len({
        row["bundle_id"]
        for row in surviving
    })


def test_report_matches_expected_output():
    output = mask_receipts(run_report()).strip()

    expected = mask_receipts(
        (
            ROOT
            / "reports"
            / "publications.expected.txt"
        ).read_text()
    ).strip()

    assert output == expected


def test_report_is_idempotent():
    first = run_report()
    second = run_report()

    assert first == second


def test_duckdb_exists():
    assert (ROOT / "releases.duckdb").exists()


def test_duckdb_tables_exist():
    db = duckdb.connect(str(ROOT / "releases.duckdb"))

    tables = {
        row[0]
        for row in db.execute("SHOW TABLES").fetchall()
    }

    assert "build_manifest" in tables
    assert "publications" in tables


def test_publication_count_matches_manifest():
    db = duckdb.connect(str(ROOT / "releases.duckdb"))

    actual = db.execute(
        "SELECT COUNT(*) FROM publications"
    ).fetchone()[0]

    expected = expected_publishable_bundle_count()

    assert actual == expected


def test_request_tokens_are_unique():
    db = duckdb.connect(str(ROOT / "releases.duckdb"))

    total = db.execute(
        "SELECT COUNT(*) FROM publications"
    ).fetchone()[0]

    distinct = db.execute(
        "SELECT COUNT(DISTINCT request_token) FROM publications"
    ).fetchone()[0]

    assert total == distinct