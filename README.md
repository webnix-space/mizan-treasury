# Mizan Treasury — Midnight Network Smart Contract Vault

A zero-knowledge privacy-preserving treasury management vault built on the Midnight Network using Compact and TypeScript.

## Architecture
- **Contract Circuit:** Compact (`contracts/TreasuryVault.compact`)
- **Prover Backend:** Midnight Proof Server
- **Private State Management:** In-memory & LevelDB private state providers with zero-knowledge witness generation
- **Deployment Target:** Midnight Preprod Network / Local Standalone Node

## Wave 1 Requirements Status
- [x] **Compact Compilation:** Circuits compiled to TypeScript bindings in `contracts/managed/TreasuryVault/`.
- [x] **Unit & Circuit Test Suite:** Verified via Jest runner (`npm test`).
- [x] **Open-Source License:** Apache-2.0 licensed.
- [x] **Wallet & Preprod Integration:** Configured with 1AM / Midnight connector interface.

## Quick Start

### 1. Run Circuit Tests
```bash
npm test


