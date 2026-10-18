# Receipt throughput and shipper handover verification — 2026-10-18

The test uses a disposable local server, synthetic PNG bank-receipt images, the repository's actual Vietnamese OCR model, real Tesseract OCR, and real HTTP order writes. It never creates orders on the live shop or calls a shipping carrier. Image size averages 46,178 bytes. Images have unique pixel data; the payment layout is intentionally the same. No bank transfers occur.

## OCR comparison

Three warm reads per case, separate baseline and modified processes, OCR cache disabled. Times include image preparation and recognition, not upload/network time. Baseline: commit 5125b9d5e554243dea63c440e481c7c32f846608. Server and dependencies run on the local test machine, not Render hardware.

| Case | Baseline median | Modified median | Outcome |
| --- | ---: | ---: | --- |
| Correct receipt | 710 ms | 519 ms | Accepted; actual amount and recipient read |
| Wrong amount | 704 ms | 552 ms | Rejected |
| Wrong recipient | 702 ms | 489 ms | Rejected |
| Menu image | 151 ms | 337 ms | Rejected; this case became slower |

The modified path removes the redundant client-preview upload/OCR and derives screening from the source image. It does not infer missing fields or waive recipient/amount checks. A bounded 64-entry, two-minute text cache now also retains negative reads; comparisons always use current server prices and recipient. Cache entries do not store payment approval.

## Order tests

| Scenario | Accepted scans | Saved unique orders | Failures | End-to-end p95 | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline 100 simultaneous scan requests | 3/100 | Not submitted | 97 rejected at admission | Not comparable | 1.64 s |
| Modified 100 sequential complete order flows | 100/100 | 100 | 0 | 672 ms | 51.35 s |
| Modified 100 simultaneous complete order flows, final upload guard enabled | 100/100 | 100 | 0 | 41,369 ms | 43.97 s |

The sequential case compresses a day's **volume**, not a full day of real arrival times. Concurrent scans are queued for one OCR worker, not processed by 100 workers. Peak process RSS in the final burst was **437 MB**. The final burst's OCR processing p95 was 524 ms and order-save p95 was 237 ms; waiting in the OCR queue accounts for most end-to-end delay. A repeated order submission was also checked and did not create a duplicate.

The queue accepts up to 100 pending jobs subject to a 128 MB spool budget. Uploaded bodies are staged on disk with private permissions and deleted after processing. Only four uploads are parsed simultaneously; busy clients receive HTTP 429 and retry with jitter. Accepted pending work can resume after a process restart **only if the filesystem survives**. This is not protection against loss of Render's ephemeral filesystem during deployment. Completed proofs are not restored across verifier-secret changes.

These results do **not** certify 100 large phone photos on a 512 MB Render instance. Clear synthetic 46 KB images are substantially smaller and easier than many real uploads; the measured RSS leaves little headroom. Larger images, different layouts, existing order history, network speed, and actual CPU allocation require further staging measurements. No production load test, deployment billing change, or paid service was used.

## Shipper regression

A real Chromium session checked that failed kitchen approval leaves the order new, successful approval waits for server acknowledgement, an expired handover session reopens login, successful login resumes the requested handover, the saved shipping state survives a reload, and the customer tracking milestone is updated. Handover does not mark the order delivered.

## Reproduction

With normal project dependencies installed and the repository's OCR model present:

```sh
TEST_REPORT_PATH=/tmp/mom-load-results.json node scripts/load-test.cjs
```

Optional `TEST_MODE=burst` or `TEST_MODE=sequential` selects one scenario; `TEST_ORDERS` can reduce the count to 1–100 for smoke tests. The harness always binds localhost and cannot take an external target URL. It removes disposable data afterward. `TEST_BASELINE_DIR` optionally points to baseline copies of server.js, receipt-jobs.js and receipt-verification.js for an admission comparison.
