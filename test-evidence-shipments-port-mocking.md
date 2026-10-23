# Test Evidence — Shipments port-based chain mocking (issue resolution)

- **Result:** PASS (exit code 0)
- **Run at:** 2026-10-22 08:06:43
- **Commit tested:** dfa83b71bb0a4ea87a76d4ad55f9db1ac546e8d3 — fixes issue #812 Migrate remaining 4 test suites to shared createEmailServiceMock
- **Working tree at run:** ?? test-evidence-shipments-port-mocking.md
- **Node:** v24.21.0 · **OS:** Windows (PowerShell) · **Runner:** jest via `npm test` (ts-jest ESM)
- **ANSI color codes stripped for readability; content otherwise verbatim.**

## Command run

```
npm test -- tests/shipments.test.ts tests/shipments.bulk-status.test.ts tests/shipments.timeline.test.ts tests/shipments.get-by-id.test.ts --verbose
```

## stdout (verbatim)

```

> test
> node --experimental-vm-modules --max-old-space-size=4096 node_modules/jest/bin/jest.js tests/shipments.test.ts tests/shipments.bulk-status.test.ts tests/shipments.timeline.test.ts tests/shipments.get-by-id.test.ts --verbose

PATCH /api/shipments/bulk/status 401 60.586 ms - 2393
GET /api/shipments/cccccccccccccccccccccccc/timeline 200 55.629 ms - 109
GET /api/shipments/cccccccccccccccccccccccc 401 65.399 ms - 2632
GET /api/shipments?limit=5&page=1 200 44.547 ms - 836
PATCH /api/shipments/bulk/status 403 15.816 ms - 2747
{"level":30,"time":"2026-10-22T07:06:41.503Z","audit":true,"userId":"manager-1","action":"SHIPMENT_STATUS_CHANGED","resource":"SHIPMENT","resourceId":"s-manager-1","timestamp":"2026-10-22T07:06:41.501Z","metadata":{"previousStatus":"CREATED","newStatus":"IN_TRANSIT"},"msg":"AUDIT: SHIPMENT_STATUS_CHANGED"}
GET /api/shipments/cccccccccccccccccccccccc 403 17.066 ms - 726
PATCH /api/shipments/bulk/status 200 14.273 ms - 90
GET /api/shipments?limit=5&page=2 200 6.174 ms - 816
GET /api/shipments/cccccccccccccccccccccccc/timeline 200 60.237 ms - 923
PATCH /api/shipments/bulk/status 400 12.123 ms - 3362
GET /api/shipments?status=IN_TRANSIT&limit=20 200 7.257 ms - 243
GET /api/shipments/cccccccccccccccccccccccc/timeline?limit=2 200 3.842 ms - 420
PATCH /api/shipments/bulk/status 400 10.993 ms - 3358
GET /api/shipments/ffffffffffffffffffffffff 404 79.659 ms - 489
GET /api/shipments/cccccccccccccccccccccccc/timeline?limit=2&cursor=2026-01-02T10%3A00%3A00.000Z%7Cstatus-IN_TRANSIT 200 5.584 ms - 524
{"level":30,"time":"2026-10-22T07:06:41.650Z","audit":true,"userId":"admin-1","action":"SHIPMENT_STATUS_CHANGED","resource":"SHIPMENT","resourceId":"s1","timestamp":"2026-10-22T07:06:41.650Z","metadata":{"previousStatus":"CREATED","newStatus":"IN_TRANSIT"},"msg":"AUDIT: SHIPMENT_STATUS_CHANGED"}
PATCH /api/shipments/bulk/status 200 8.207 ms - 90
{"level":30,"time":"2026-10-22T07:06:41.651Z","audit":true,"userId":"admin-1","action":"SHIPMENT_STATUS_CHANGED","resource":"SHIPMENT","resourceId":"s2","timestamp":"2026-10-22T07:06:41.650Z","metadata":{"previousStatus":"CREATED","newStatus":"IN_TRANSIT"},"msg":"AUDIT: SHIPMENT_STATUS_CHANGED"}
{"level":30,"time":"2026-10-22T07:06:41.653Z","audit":true,"userId":"admin-1","action":"SHIPMENT_STATUS_CHANGED","resource":"SHIPMENT","resourceId":"s3","timestamp":"2026-10-22T07:06:41.652Z","metadata":{"previousStatus":"CREATED","newStatus":"IN_TRANSIT"},"msg":"AUDIT: SHIPMENT_STATUS_CHANGED"}
GET /api/shipments/cccccccccccccccccccccccc 403 11.296 ms - 536
{"level":30,"time":"2026-10-22T07:06:41.698Z","audit":true,"userId":"admin-1","action":"SHIPMENT_STATUS_CHANGED","resource":"SHIPMENT","resourceId":"s1","timestamp":"2026-10-22T07:06:41.698Z","metadata":{"previousStatus":"CREATED","newStatus":"IN_TRANSIT"},"msg":"AUDIT: SHIPMENT_STATUS_CHANGED"}
PATCH /api/shipments/bulk/status 200 2.911 ms - 208
{"level":30,"time":"2026-10-22T07:06:41.720Z","audit":true,"userId":"admin-1","action":"SHIPMENT_STATUS_CHANGED","resource":"SHIPMENT","resourceId":"s1","timestamp":"2026-10-22T07:06:41.720Z","metadata":{"previousStatus":"CREATED","newStatus":"IN_TRANSIT"},"msg":"AUDIT: SHIPMENT_STATUS_CHANGED"}
GET /api/shipments/cccccccccccccccccccccccc 200 3.377 ms - 271
PATCH /api/shipments/bulk/status 200 2.808 ms - 131
{"level":30,"time":"2026-10-22T07:06:41.745Z","audit":true,"userId":"admin-1","action":"SHIPMENT_STATUS_CHANGED","resource":"SHIPMENT","resourceId":"s1","timestamp":"2026-10-22T07:06:41.745Z","metadata":{"previousStatus":"CREATED","newStatus":"IN_TRANSIT"},"msg":"AUDIT: SHIPMENT_STATUS_CHANGED"}
PATCH /api/shipments/bulk/status 200 2.803 ms - 90
{"level":40,"time":"2026-10-22T07:06:41.701Z","err":{"type":"BSONError","message":"input must be a 24 character hex string, 12 byte Uint8Array, or an integer","stack":"BSONError: input must be a 24 character hex string, 12 byte Uint8Array, or an integer\n    at new ObjectId (C:\\Users\\USER\\Documents\\For-Abk\\navin-backend\\node_modules\\bson\\src\\objectid.ts:120:15)\n    at Module.createLedgerBlock (C:\\Users\\USER\\Documents\\For-Abk\\navin-backend\\src\\modules\\ledger\\ledger.repo.ts:41:17)\n    at createLedgerBlockService (C:\\Users\\USER\\Documents\\For-Abk\\navin-backend\\src\\modules\\ledger\\ledger.service.ts:8:34)\n    at updateShipmentStatusService (C:\\Users\\USER\\Documents\\For-Abk\\navin-backend\\src\\modules\\shipments\\shipments.service.ts:648:11)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at patchShipmentStatus (C:\\Users\\USER\\Documents\\For-Abk\\navin-backend\\src\\modules\\shipments\\shipments.controller.ts:223:19)"},"shipmentId":"0","status":"IN_TRANSIT","msg":"Failed to create ledger block for status change"}
PATCH /api/shipments/0/status 200 395.547 ms - 357
{"level":30,"time":"2026-10-22T07:06:42.083Z","audit":true,"userId":"0","action":"SHIPMENT_STATUS_CHANGED","resource":"SHIPMENT","resourceId":"0","timestamp":"2026-10-22T07:06:42.083Z","metadata":{"previousStatus":"CREATED","newStatus":"IN_TRANSIT"},"msg":"AUDIT: SHIPMENT_STATUS_CHANGED"}
POST /api/shipments 401 10.422 ms - 2393
POST /api/shipments 403 7.119 ms - 2747
{"level":40,"time":"2026-10-22T07:06:42.292Z","err":{"type":"AppError","message":"STELLAR_SECRET_KEY is not configured","stack":"AppError: STELLAR_SECRET_KEY is not configured\n    at tokenizeShipment (C:\\Users\\USER\\Documents\\For-Abk\\navin-backend\\src\\services\\stellar.service.ts:33:11)\n    at createShipmentService (C:\\Users\\USER\\Documents\\For-Abk\\navin-backend\\src\\modules\\shipments\\shipments.service.ts:528:27)\n    at processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at createShipment (C:\\Users\\USER\\Documents\\For-Abk\\navin-backend\\src\\modules\\shipments\\shipments.controller.ts:171:20)","statusCode":500,"code":"ERR_STELLAR_CONFIG","name":"AppError"},"shipmentId":"0","msg":"Stellar tokenization skipped"}
POST /api/shipments 201 11.431 ms - 182
{"level":30,"time":"2026-10-22T07:06:42.299Z","audit":true,"userId":"0","action":"SHIPMENT_CREATED","resource":"SHIPMENT","resourceId":"0","timestamp":"2026-10-22T07:06:42.299Z","metadata":{"trackingNumber":"TN-NEW-1","origin":"A","destination":"B"},"msg":"AUDIT: SHIPMENT_CREATED"}
PATCH /api/shipments/123 401 2.283 ms - 2632
PATCH /api/shipments/123 403 2.870 ms - 2986
POST /api/shipments/123/documents 400 30.880 ms - 1903
POST /api/shipments/123/photos 400 3.942 ms - 1903
POST /api/shipments/123/proof 401 1.581 ms - 2632
GET /api/shipments/123/eta 401 2.156 ms - 2632
POST /api/shipments/123/proof 403 2.541 ms - 2986
[Global Teardown] Starting cleanup...
[Global Teardown] Stopped shared MongoDB Memory Server
[Global Teardown] Cleanup complete

```

## stderr (verbatim)

```
node.exe : (node:2692) ExperimentalWarning: VM Modules is an experimental feature and might change at any time
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Users\USER\AppData\Roaming\n ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: ((node:2692) Exp...nge at any time:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError

(Use `node --trace-warnings ...` to show where the warning was created)
(node:24480) ExperimentalWarning: VM Modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:13216) ExperimentalWarning: VM Modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
(node:24420) ExperimentalWarning: VM Modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Test Suites: 4 passed, 4 total
Tests:       30 passed, 30 total
Snapshots:   0 total
Time:        12.263 s, estimated 14 s
Ran all test suites matching tests/shipments.test.ts|tests/shipments.bulk-status.test.ts|tests/shipments.timeline.test.
ts|tests/shipments.get-by-id.test.ts.

```

## Per-suite breakdown (from jest's own --json report of the run above)

- `tests/shipments.bulk-status.test.ts` — PASSED (9/9 tests)
- `tests/shipments.get-by-id.test.ts` — PASSED (5/5 tests)
- `tests/shipments.timeline.test.ts` — PASSED (3/3 tests)
- `tests/shipments.test.ts` — PASSED (13/13 tests)

- **jest `success` flag:** `True` · total: `30/30` tests, `4/4` suites · exit code `0`
