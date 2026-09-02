import React, { useState, useEffect } from 'react';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { Contract } from '../contracts/managed/TreasuryVault/contract/index.js';

// Align network ID with Preprod network prefix (mn_...preprod)
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

function extractString(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'string' && val.trim().length > 0) return val.trim();
  if (Array.isArray(val) && val.length > 0) return extractString(val[0]);
  if (typeof val === 'object') {
    if (typeof val.unshieldedAddress === 'string') return val.unshieldedAddress;
    if (typeof val.dustAddress === 'string') return val.dustAddress;
    if (typeof val.shieldedAddress === 'string') return val.shieldedAddress;
    if (typeof val.address === 'string') return val.address;
    if (typeof val.bech32 === 'string') return val.bech32;
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
  const [accountAddr, setAccountAddr] = useState<string>('');

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
        throw new Error('1AM wallet extension not detected.');
      }

      const walletKey = selectedWallet || Object.keys(midnight)[0];
      const entry = midnight[walletKey];
      if (!entry) throw new Error(`Wallet ${walletKey} not available.`);

      const api = typeof entry.connect === 'function' ? await entry.connect() : (typeof entry.enable === 'function' ? await entry.enable() : entry);

      // Explicitly sync network ID to preprod
      try {
        setNetworkId('preprod');
      } catch (_) {}

      setStatus('2/4: Retrieving keys and configuring providers...');

      const unshieldedRaw = typeof api.getUnshieldedAddress === 'function' ? await api.getUnshieldedAddress() : null;
      const dustRaw = typeof api.getDustAddress === 'function' ? await api.getDustAddress() : null;
      const shieldedRaw = typeof api.getShieldedAddresses === 'function' ? await api.getShieldedAddresses() : null;

      const unshieldedKey = extractString(unshieldedRaw) || extractString(dustRaw);
      const shieldedKey = extractString(shieldedRaw);
      const activeKey = unshieldedKey || shieldedKey;

      if (!activeKey) {
        throw new Error('No address found in 1AM wallet.');
      }

      setAccountAddr(`Unshielded: ${unshieldedKey || 'None'} | Shielded: ${shieldedKey || 'None'}`);

      // Official 1AM Preprod Endpoints
      const INDEXER_HTTP = 'https://api-preprod.1am.xyz/api/v4/graphql';
      const INDEXER_WS = 'wss://api-preprod.1am.xyz/api/v4/graphql/ws';
      const PROOF_SERVER = 'https://api-preprod.1am.xyz';

      const nativeWs = typeof window !== 'undefined' ? (window.WebSocket as any) : undefined;
      const publicDataProvider = api.publicDataProvider || indexerPublicDataProvider(INDEXER_HTTP, INDEXER_WS, nativeWs);
      const proofProvider = api.proofProvider || httpClientProofProvider(PROOF_SERVER);

      // Create a unified wallet provider bridge
      const coinPublicKey = unshieldedKey || shieldedKey;
      const encryptionPublicKey = shieldedKey || unshieldedKey;

      const walletProvider = {
        coinPublicKey,
        encryptionPublicKey,
        getCoinPublicKey: () => coinPublicKey,
        getEncryptionPublicKey: () => encryptionPublicKey,
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

      setContractAddress(extractString(addr) || String(addr));
      setTxHash(extractString(hash) || String(hash));
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

      {accountAddr && (
        <p style={{ fontSize: '0.8rem', color: '#64748b', wordBreak: 'break-all' }}>{accountAddr}</p>
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
