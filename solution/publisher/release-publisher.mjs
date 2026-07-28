import duckdb from "duckdb";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

const db = new duckdb.Database("releases.duckdb");

function run(sql) {
    return new Promise((resolve, reject) => {
        db.run(sql, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// function all(sql) {
//     return new Promise((resolve, reject) => {
//         db.all(sql, (err, rows) => {
//             if (err) reject(err);
//             else resolve(rows);
//         });
//     });
// }

function all(sql) {
    return new Promise((resolve, reject) => {
        db.all(sql, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function createTables() {

    await run(`
        CREATE TABLE IF NOT EXISTS build_manifest (
            entry_id TEXT,
            bundle_id TEXT,
            component_id TEXT,
            version TEXT,
            size_bytes BIGINT,
            record_type TEXT,
            supersedes_id TEXT,
            recorded_at TIMESTAMP
        );
    `);

    await run(`
        CREATE TABLE IF NOT EXISTS publications (
            bundle_id TEXT PRIMARY KEY,
            request_token TEXT,
            publication_id TEXT,
            status TEXT
        );
    `);

}


async function loadManifest() {

    await run(`
        DELETE FROM build_manifest;
    `);

    await run(`
        INSERT INTO build_manifest
        SELECT *
        FROM read_csv_auto(
            'fixtures/build_manifest.csv',
            HEADER=TRUE
        );
    `);

}


async function getPublishableBundles() {

    return await all(`

        WITH deduplicated AS (

            SELECT DISTINCT *
            FROM build_manifest

        ),

        withdrawn AS (

            SELECT supersedes_id
            FROM deduplicated
            WHERE record_type='WITHDRAWAL'

        ),

        surviving_builds AS (

            SELECT *
            FROM deduplicated
            WHERE record_type='BUILD'
              AND entry_id NOT IN (
                    SELECT supersedes_id
                    FROM withdrawn
              )

        )

        SELECT

            bundle_id,

            COUNT(*) AS artifact_count,

            SUM(size_bytes) AS total_bytes

        FROM surviving_builds

        GROUP BY bundle_id

        ORDER BY bundle_id;

    `);

}

async function getCurrentSigningKey() {
    const response = await fetch(
        "http://127.0.0.1:7070/v1/signing-key/current"
    );

    if (!response.ok) {
        throw new Error(
            `Unable to fetch signing key: ${response.status}`
        );
    }

    return await response.json();
}

function createDescriptor(bundle) {
    return JSON.stringify({
        artifact_count: Number(bundle.artifact_count),
        bundle_id: bundle.bundle_id,
        total_bytes: Number(bundle.total_bytes)
    });
}

async function signDescriptor(descriptor) {

    const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "publisher-")
    );

    const descriptorFile = path.join(tempDir, "descriptor.json");
    const signatureFile = path.join(tempDir, "signature.pem");

    await fs.writeFile(descriptorFile, descriptor, "utf8");

    await execFileAsync("openssl", [
        "cms",
        "-sign",
        "-binary",
        "-in",
        descriptorFile,
        "-signer",
        "/app/keys/current/current.cert.pem",
        "-inkey",
        "/app/keys/current/current.key.pem",
        "-outform",
        "PEM",
        "-out",
        signatureFile
    ]);

    const signature = await fs.readFile(signatureFile, "utf8");

    await fs.rm(tempDir, {
        recursive: true,
        force: true
    });

    return signature;
}

async function publishDescriptor(descriptor, signature, requestToken) {

    const response = await fetch(
        "http://127.0.0.1:7070/v1/publications",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                descriptor,
                signature,
                request_token: requestToken,
            }),
        }
    );

    const result = await response.json();

    return result;
}


async function main() {

    
    await createTables();

    
    await loadManifest();

    
    const bundles = await getPublishableBundles();

    
    const signingKey = await getCurrentSigningKey();


    // Publish every bundle instead of only the first one
    for (const bundle of bundles) {

    const requestToken = `token-${bundle.bundle_id}`;

    const existing = await get(`
        SELECT *
        FROM publications
        WHERE bundle_id='${bundle.bundle_id}'
    `);

    console.log(
        `BUNDLE ${bundle.bundle_id} SIGNED KEY=${signingKey.key_id}`
    );

    if (existing) {

        console.log(
            `BUNDLE ${bundle.bundle_id} PUBLISHED RECEIPT=${existing.publication_id} TOKEN=${existing.request_token} STATUS=${existing.status}`
        );

        continue;
    }

    const descriptor = createDescriptor(bundle);

    const signature = await signDescriptor(descriptor);

    const receipt = await publishDescriptor(
            descriptor,
            signature,
            requestToken
        );

    if (receipt.error) {
        console.error(receipt);
        continue;
    }

       await run(`
            INSERT INTO publications
            (
                bundle_id,
                request_token,
                publication_id,
                status
            )
            VALUES (
                '${bundle.bundle_id}',
                '${receipt.request_token}',
                '${receipt.publication_id}',
                '${receipt.status}'
            );
            `);

        console.log(
            `BUNDLE ${bundle.bundle_id} PUBLISHED RECEIPT=${receipt.publication_id} TOKEN=${receipt.request_token} STATUS=${receipt.status}`
        );
    }


    }
main().catch((err) => {
    console.error(err);
    process.exit(1);
});


async function get(sql) {
    const rows = await all(sql);
    return rows.length ? rows[0] : null;
}