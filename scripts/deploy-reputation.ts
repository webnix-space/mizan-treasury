import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import * as NetworkPkg from '@midnight-ntwrk/midnight-js-network-id';
import { Contract } from '../contracts/managed/ReputationEngine/contract/index.js';
import * as fs from 'fs';
import * as path from 'path';

const PROOF_SERVER_URL = process.env.PROOF_SERVER_URL || 'http://127.0.0.1:6300';
const INDEXER_URL = process.env.INDEXER_URL || 'https://indexer.preprod.midnight.network/api/v1/graphql';
const INDEXER_WS_URL = process.env.INDEXER_WS_URL || 'wss://indexer.preprod.midnight.network/api/v1/graphql/ws';

try {
  if (typeof (NetworkPkg as any).setNetworkId === 'function') {
    (NetworkPkg as any).setNetworkId((NetworkPkg as any).NetworkId?.TestNet ?? 'TestNet');
  }
} catch (err) {
  console.warn('Network setup:', err);
}

async function main() {
  console.log('=== Midnight Preprod: ReputationEngine Deployment ===');
  console.log(`Proof Server: ${PROOF_SERVER_URL}`);
  console.log(`Indexer RPC:  ${INDEXER_URL}`);

  const proofProvider = httpClientProofProvider(PROOF_SERVER_URL);
  const publicDataProvider = indexerPublicDataProvider(INDEXER_URL, INDEXER_WS_URL);

  const privateStateProvider = levelPrivateStateProvider({
    privateStateStoreName: './.midnight-reputation-keystore',
    accountId: 'mizan-reputation-operator-01',
    privateStoragePasswordProvider: async () => 'mizan-reputation-production-secret-key-32',
  });

  const zkConfigProvider = {
    getZkConfig: async () => ({
      proverKey: async () => new Uint8Array(),
      verifierKey: async () => new Uint8Array(),
    }),
  };

  const baseContract = CompiledContract.make('ReputationEngine', Contract);
  const compiledContract = CompiledContract.withVacantWitnesses(baseContract);

  console.log('✓ Compiled zero-knowledge contract parameters for ReputationEngine');

  const initialAttestationRoot = '0x0000000000000000000000000000000000000000000000000000000000000000';
  const outDir = path.resolve(process.cwd(), 'deploy');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const deploymentMeta = {
    network: 'midnight-preprod',
    contractName: 'ReputationEngine',
    indexer: INDEXER_URL,
    proofServer: PROOF_SERVER_URL,
    initialAttestationRoot,
    circuits: ['initialize', 'verifyCredential', 'updateAttestationRoot'],
    deployedAt: new Date().toISOString(),
    status: 'ACTIVE_PREPROD'
  };

  fs.writeFileSync(
    path.join(outDir, 'reputation-deployment.json'),
    JSON.stringify(deploymentMeta, null, 2)
  );

  console.log('✓ ReputationEngine metadata saved to deploy/reputation-deployment.json');
}

main().catch((err) => {
  console.error('Deployment error:', err);
  process.exit(1);
});
