# ABI Source Record (P11-02)

This document records the provenance and checksums for the vendored Soroban contract ABIs and schemas.

## Source Repository

- **Repository**: `https://github.com/Navin-xmr/navin-contracts`
- **Pinned Commit**: `dc53a0cba3f2bc6478e6d4dcfb45a135537c111b`
- **Spec Version**: `2.2.0`
- **Date Vendored**: 2026-11-24

## Vendored Artifacts & SHA-256 Checksums

| File Path                                | SHA-256 Checksum                                                   | Description                          |
| ---------------------------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| `contracts/abi/navin-escrow.abi.json`    | `9c1045c5ebf81c3944f9fe7c3964e6b667f246fb1fd4ed2cf7208cd2d7078f65` | Navin Escrow & Shipment contract ABI |
| `docs/abi/contract-schema.shipment.json` | `81a6a4e37eb9daec988cea8c48438be8ff5f739eaaf9396b1ebdbfa4686c592c` | Generated shipment contract schema   |

## Mechanical Verification & Sync

To verify that vendored ABI files match their recorded checksums and haven't drifted:

```bash
npm run sync:abi -- --verify
```

To refresh checksums after a planned upstream upgrade:

```bash
npm run sync:abi -- --refresh
```
