# AUTHOR_NOTES.md

# Author Notes

## Task Overview

This task requires the candidate to implement a JavaScript release publisher that integrates with an existing Express distribution gateway.

The publisher must:

* Import a CSV build manifest into DuckDB.
* Reconcile duplicate manifest rows.
* Apply withdrawal records correctly.
* Produce canonical release descriptors.
* Generate detached OpenSSL CMS signatures using the current signing key.
* Publish descriptors through the provided gateway.
* Persist publication receipts inside DuckDB.
* Produce deterministic CLI output matching the provided snapshot.

The supplied Express gateway performs real cryptographic verification of CMS signatures and rejects descriptors signed with revoked keys.

---

# Candidate Challenges

The task intentionally combines several independent concepts rather than focusing on only one API.

The expected solution requires understanding of:

* DuckDB SQL
* CSV import
* SQL reconciliation logic
* Express REST APIs
* OpenSSL CMS signing
* Deterministic serialization
* Idempotent publishing
* Database persistence

A solver cannot pass by implementing only part of the workflow.

---

# Important Grading Traps

## 1. Revoked signing key

Using the revoked certificate results in an `UNTRUSTED_SIGNATURE` response from the gateway.

The publisher must use the current key generated during the Docker image build.

---

## 2. Duplicate manifest rows

The manifest may contain exact duplicate rows.

The publisher must collapse only exact duplicates before publication.

The verifier independently recomputes the expected bundle count from the CSV instead of relying on hard-coded values.

---

## 3. Withdrawals

Withdrawal rows reference a previous build through `supersedes_id`.

Any build referenced by a withdrawal must not be published.

---

## 4. Deterministic output

Receipt identifiers are generated randomly by the gateway.

The verifier masks receipt identifiers before comparing CLI output with the expected report, ensuring only deterministic content is graded.

---

## 5. Idempotency

Running the publisher multiple times should not create duplicate publications.

Repeated executions should reuse request tokens and produce identical CLI output.

---

# Verification Performed

The reference solution was validated by:

* Building the Docker image successfully.
* Starting the supplied Express gateway.
* Running the reference publisher.
* Verifying successful CMS signature validation.
* Confirming DuckDB tables were populated correctly.
* Executing:

```bash
bash /tests/test.sh
```

The verifier produced:

* `reward.txt = 1`
* All pytest tests passed.

Negative testing was also performed by intentionally breaking publisher behavior (for example, incorrect output formatting and publication logic), confirming that the verifier correctly returned `reward.txt = 0`.

---

# Binary Reward Verification

The verifier produces only binary rewards.

Successful execution:

* All pytest tests pass.
* `/logs/verifier/reward.txt` contains:

```
1
```

Any failure causes:

```
0
```

This satisfies Harbor's binary reward requirement.

---

# Notes

The verifier recomputes expected publication counts directly from the input manifest and validates database state instead of depending solely on hard-coded expected values.

The gateway ledger is treated as an internal implementation detail and is never read directly by the publisher or verifier.
