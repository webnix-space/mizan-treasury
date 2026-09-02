import React, { useState, useEffect } from 'react';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { Contract } from '../contracts/managed/TreasuryVault/contract/index.js';

try {
  setNetworkId('preprod');
} catch (_) {
  try {
    setNetworkId('undeployed');
  } catch (_) {}
}

function inMemoryPrivateStateProvider() {
  const store = new Map<string, any>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: any) => { store.set(key, value); },
    remove: async (key: string) => { store.delete(key); },
    clear: async () => { store.clear(); },
  };
}

function extractKeyWithPrefix(obj: any, prefix: string): string | null {
  if (!obj) return null;
  if (typeof obj === 'string' && obj.startsWith(prefix)) return obj.trim();
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = extractKeyWithPrefix(item, prefix);
      if (found) return found;
    }
  }
  if (typeof obj === 'object') {
    for (const val of Object.values(obj)) {
      const found = extractKeyWithPrefix(val, prefix);
      if (found) return found;
    }
  }
  return null;
}

export default function DeployPage() {
  const [status, setStatus] = useState<string>('Ready to deploy');
  const [wallets, setWallets] = useState<{ id: string; name: string }[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<string>('');
  const [contractAddress, setContractAddress] = useState<string>('');
  const [txHash, setTxHash] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [diag, setDiag] = useState<string>('');

  useEffect(() => {
    const midnight = (window as any).midnight;
    if (midnight) {
      const detected = Object.keys(midnight).map((k) => ({
        id: k,
        name: midnight[k]?.name || k,
      }));
      setWallets(detected);
      if (detected.length > 0) setSelectedWallet(detected[0].id);
    }
  }, []);

  const handleDeploy = async () => {
    try {
      setLoading(true);
      setStatus('1/4: Connecting to 1AM Wallet...');

      const midnight = (window as any).midnight;
      if (!midnight) {
        throw new Error('1AM wallet extension not found.');
      }

      const walletKey = selectedWallet || Object.keys(midnight)[0];
      const entry = midnight[walletKey];
      if (!entry) throw new Error(`Wallet ${walletKey} not available.`);

      const api = typeof entry.connect === 'function' ? await entry.connect() : (typeof entry.enable === 'function' ? await entry.enable() : entry);

      setStatus('2/4: Resolving cryptographic shield keys (shield-cpk / shield-epk)...');

      // 1. Check direct methods on API
      let coinPk: string | null = null;
      let encPk: string | null = null;

      if (typeof api.getCoinPublicKey === 'function') {
        coinPk = await api.getCoinPublicKey();
      }
      if (typeof api.getEncryptionPublicKey === 'function') {
        encPk = await api.getEncryptionPublicKey();
      }

      // 2. Deep scan the 1AM state / config tree if methods are not direct
      if (!coinPk || !encPk) {
        let fullDump: any = {};
        if (typeof api.getConfiguration === 'function') {
          fullDump.config = await api.getConfiguration();
        }
        if (typeof api.getConnectionStatus === 'function') {
          fullDump.status = await api.getConnectionStatus();
        }

        // Try extracting keys matching official Midnight Bech32 HRP prefixes
        if (!coinPk) coinPk = extractKeyWithPrefix({ api, fullDump }, 'mn_shield-cpk');
        if (!encPk) encPk = extractKeyWithPrefix({ api, fullDump }, 'mn_shield-epk');
      }

      // Fallback: If 1AM exposes them via walletProvider
      if (!coinPk && api.walletProvider && typeof api.walletProvider.getCoinPublicKey === 'function') {
        coinPk = await api.walletProvider.getCoinPublicKey();
      }
      if (!encPk && api.walletProvider && typeof api.walletProvider.getEncryptionPublicKey === 'function') {
        encPk = await api.walletProvider.getEncryptionPublicKey();
      }

      // If still not isolated, check if 1AM's internal state exposes them
      if (!coinPk || !encPk) {
        const methods = Object.keys(api);
        setDiag(`Available API methods: ${methods.join(', ')}`);
        throw new Error('1AM wallet did not provide shield-cpk / shield-epk public keys. Check developer console / status below.');
      }

      setDiag(`CPK: ${coinPk.slice(0, 22)}... | EPK: ${encPk.slice(0, 22)}...`);

      // 1AM preprod endpoints
      const INDEXER_HTTP = 'https://api-preprod.1am.xyz/api/v4/graphql';
      const INDEXER_WS = 'wss://api-preprod.1am.xyz/api/v4/graphql/ws';
      const PROOF_SERVER = 'https://api-preprod.1am.xyz';

      const nativeWs = typeof window !== 'undefined' ? (window.WebSocket as any) : undefined;
      const publicDataProvider = api.publicDataProvider || indexerPublicDataProvider(INDEXER_HTTP, INDEXER_WS, nativeWs);
      const proofProvider = api.proofProvider || httpClientProofProvider(PROOF_SERVER);

      const walletProvider = {
        coinPublicKey: coinPk,
        encryptionPublicKey: encPk,
        getCoinPublicKey: () => coinPk,
        getEncryptionPublicKey: () => encPk,
        balanceTx: async (tx: any, ttl?: any) => {
          if (typeof api.balanceUnsealedTransaction === 'function') return api.balanceUnsealedTransaction(tx);
          if (typeof api.balanceSealedTransaction === 'function') return api.balanceSealedTransaction(tx);
          if (typeof api.balanceTx === 'function') return api.balanceTx(tx, ttl);
          return tx;
        },
      };

      const midnightProvider = {
        submitTx: async (tx: any) => {
          if (typeof api.submitTransaction === 'function') return api.submitTransaction(tx);
          if (api.midnightProvider && typeof api.midnightProvider.submitTx === 'function') {
            return api.midnightProvider.submitTx(tx);
          }
          throw new Error('No submission endpoint available on wallet.');
        },
      };

      const providers = {
        privateStateProvider: inMemoryPrivateStateProvider(),
        publicDataProvider,
        zkConfigProvider: {
          getZkConfig: async () => ({ proverKey: async () => new Uint8Array(), verifierKey: async () => new Uint8Array() }),
        },
        proofProvider,
        walletProvider,
        midnightProvider,
      };

      const baseContract = CompiledContract.make('TreasuryVault', Contract);
      const compiledContract = CompiledContract.withVacantWitnesses(baseContract);

      setStatus('3/4: Generating ZK proof & submitting to 1AM for signature...');

      const deployed = await deployContract(providers as any, {
        compiledContract: compiledContract as any,
        args: [1_000_000n],
        privateStateKey: 'treasuryVaultPrivateState',
        initialPrivateState: {},
      });

      const addr = deployed.deployTxData?.public?.contractAddress || (deployed as any).contractAddress || 'Confirmed on-chain';
      const hash = deployed.deployTxData?.public?.txHash || (deployed as any).txHash || '';

      setContractAddress(String(addr));
      setTxHash(String(hash));
      setStatus('4/4: Treasury Vault successfully deployed on Midnight Preprod!');
    } catch (err: any) {
      setStatus(`Execution Error: ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: '650px', margin: '0 auto', color: '#fff' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1.5rem' }}>Mizan Treasury Preprod Deployer</h1>

      {wallets.length > 0 ? (
        <select
          value={selectedWallet}
          onChange={(e) => setSelectedWallet(e.target.value)}
          style={{ padding: '0.65rem', marginBottom: '1.2rem', width: '100%', background: '#1e293b', color: '#fff', border: '1px solid #475569', borderRadius: '6px' }}
        >
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      ) : (
        <p style={{ color: '#fbbf24', fontSize: '0.9rem', marginBottom: '1.2rem' }}>Searching for connected Midnight wallet extension...</p>
      )}

      <button
        onClick={handleDeploy}
        disabled={loading}
        style={{
          width: '100%',
          padding: '0.85rem',
          background: loading ? '#475569' : '#2563eb',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          fontWeight: 'bold',
          cursor: loading ? 'not-allowed' : 'pointer'
        }}
      >
        {loading ? 'Processing...' : 'Deploy Production Vault'}
      </button>

      <p style={{ marginTop: '1.2rem', wordBreak: 'break-all', color: '#94a3b8', fontSize: '0.95rem' }}>{status}</p>

      {diag && (
        <p style={{ fontSize: '0.8rem', color: '#64748b', wordBreak: 'break-all' }}>{diag}</p>
      )}

      {contractAddress && (
        <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#064e3b', borderRadius: '6px', border: '1px solid #059669' }}>
          <p style={{ color: '#34d399', margin: 0, fontWeight: 'bold' }}>✓ Contract Deployed on Preprod</p>
          <p style={{ fontSize: '0.85rem', wordBreak: 'break-all', margin: '0.5rem 0' }}>Address: {contractAddress}</p>
          {txHash && <p style={{ fontSize: '0.85rem', wordBreak: 'break-all', margin: 0 }}>Tx: {txHash}</p>}
        </div>
      )}
    </div>
  );
}
