# Mizan (ميزان)

> **Zero-Knowledge Workforce & Sovereign Treasury Platform**
> *Where balance meets sovereign privacy — prove solvency without exposure, earn without surveillance.*

Built natively on **Midnight Blockchain** | **Apache 2.0 License** | **Non-Custodial**

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Network](https://img.shields.io/badge/Midnight-Preprod-purple.svg)](https://docs.midnight.network)
[![Live dApp](https://img.shields.io/badge/Live_dApp-Vercel-success.svg)](https://mizan-webnix.vercel.app)

---

## 1. Executive Summary

**Mizan** merges non-custodial private payroll infrastructure with self-sovereign verifiable credentials and predictive treasury management into a legally resilient platform on the Midnight blockchain.

- **For Workers:** Earn privately. Build self-sovereign reputation bound to payroll history. Prove career tenure without revealing wages or employer identities.
- **For Employers:** Pay global teams with zero balance-sheet disclosure. Prove treasury solvency to investors and staff using zero-knowledge circuits.
- **For Auditors:** Decrypt time-scoped records via selective disclosure keys to satisfy regulatory compliance without mass surveillance.

---

## 2. Wave 1 Live Deliverables (Midnight Preprod)

All Wave 1 technical requirements have been deployed, initialized, and verified on the **Midnight Preprod Network**:

- **Contract Address:** `f66688e31ec9ce1665a54336aae31a82c3534db9437e8d3278b66c9cc4c80ea4`
- **Deployment Transaction:** `4eb3efaf048bef7d44c9e18cda47bfe8adf4e8ab8a8d6972c22df805d55fd91f`
- **Initialize Circuit Transaction (`initialize(0)`):** `6f2768ea4a786d7d4ef0e3a5c2289e7fb082cde965f31d1e578a00c837b8e8c1`
- **Shielded Deposit Transaction (`deposit(1000)`):** `46f80ac8b6d288599de43ece9d080a7f9498485139f72672a3a94a117e83d445`
- **GraphQL Indexer Verified State:** `isInitialized = true`, `totalVaultReserves = 1000`

---

## 3. System Architecture & Dual-Ledger Model

Mizan leverages Midnight's dual-ledger paradigm:
1. **Public State:** Solvency commitments, contract deployment state, and aggregated Merkle roots verified by anyone on the network.
2. **Private State:** Individual salary amounts, employee wallet destinations, and employer balance sheets maintained confidential off-chain.
3. **ZK Proofs:** Proved client-side in the browser using the 1AM wallet provider and native binary `.bzkir` compilation.

```
+--------------------------------------------------------+
|                   L4 Interface Layer                   |
|   Responsive Dashboard * 1AM Wallet * Credential Hub   |
+---------------------------+----------------------------+
                            |
+---------------------------v----------------------------+
|                  L2 Compact Contracts                  |
|       TreasuryVault * CredentialRegistry (Wave 1)      |
|     ReputationEngine (Wave 2) * zkML Treasury (Wave 3) |
+---------------------------+----------------------------+
                            |
+---------------------------v----------------------------+
|                 L1 ZK Proving Pipeline                 |
|      Native .bzkir Circuits * Solvency Invariant       |
|        Midnight Preprod Ledger & GraphQL Indexer       |
+--------------------------------------------------------+
```

---

## 4. Repository Structure

```
contracts/
  TreasuryVault.compact        # Primary Compact smart contract circuit
  managed/TreasuryVault/       # Auto-generated TypeScript contract bindings
public/
  TreasuryVault/
    zkir/                      # Binary .bzkir proving artifacts
    keys/                      # Prover & verifier keys
src/
  DeployPage.tsx               # 3D Dashboard & Midnight dApp connector
  main.tsx                     # Vite application entry point
test/                          # Jest unit & circuit testing suite
LICENSE                        # Apache License 2.0
README.md                      # Documentation & submission dossier
```

---

## 5. Getting Started

### Prerequisites
- Node.js >= 18.0.0
- Midnight 1AM Wallet browser extension configured to **Preprod**

### Installation
```bash
git clone https://github.com/webnix-space/mizan-treasury.git
cd mizan-treasury
npm install
npm test
npm run dev
```

---

## 6. Multi-Wave Roadmap

- **Wave 1 (Complete):** Core Payroll, TreasuryVault, Client-Side `.bzkir` Prover, ZK-Solvency Circuit, and Basic Credentials.
- **Wave 2 (Upcoming):** Compounding Reputation Engine with encrypted peer ratings and aggregate ZK proofs.
- **Wave 3 (Upcoming):** Predictive zkML Treasury runway modeling and Selective Disclosure auditor portal.

---

## 7. Submission & Demo Links

- **Live Application:** https://mizan-webnix.vercel.app
- **Video Walkthrough:** https://www.youtube.com/watch?v=V06bvNEmm6I
- **Source Code:** https://github.com/webnix-space/mizan-treasury

---

## 8. License & Attribution

Built by **Webnix** under the **Apache License 2.0**.  
Designed for the **Midnight Buildathon**.
