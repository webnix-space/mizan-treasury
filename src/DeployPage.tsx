import React, { useState, useEffect } from 'react';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { Contract } from '../contracts/managed/TreasuryVault/contract/index.js';

// Initialize network ID globally at module evaluation
try {
  setNetworkId('undeployed');
} catch (_) {}

function inMemoryPrivateStateProvider() {
  const store = new Map<string, any>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: any) => { store.set(key, value); },
    remove: async (key: string) => { store.delete(key); },
    clear: async () => { store.clear(); },
  };
}

export default function DeployPage() {
  const [status, setStatus] = useState<string>('Ready to deploy');
  const [wallets, setWallets] = useState<{ id: string; name: string }[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<string>('');
  const [contractAddress, setContractAddress] = useState<string>('');
  const [txHash, setTxHash] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);

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
      setStatus('Connecting to 1AM Wallet...');

      const midnight = (window as any).midnight;
      if (!midnight) {
        throw new Error('Midnight compatible wallet extension not detected.');
      }

      const walletKey = selectedWallet || Object.keys(midnight)[0];
      const entry = midnight[walletKey];
      if (!entry) throw new Error(`Wallet ${walletKey} not available.`);

      const api = typeof entry.enable === 'function' ? await entry.enable() : entry;

      if (typeof api.getNetworkId === 'function') {
        const net = await api.getNetworkId();
        if (net) {
          try {
            setNetworkId(net);
          } catch (_) {}
        }
      }

      const providers = {
        privateStateProvider: inMemoryPrivateStateProvider(),
        publicDataProvider: api.publicDataProvider,
        zkConfigProvider: api.zkConfigProvider || {
          getZkConfig: async () => ({ proverKey: async () => new Uint8Array(), verifierKey: async () => new Uint8Array() })
        },
        proofProvider: api.proofProvider,
        walletProvider: api.walletProvider || api,
        midnightProvider: api.midnightProvider || api,
      };

      const baseContract = CompiledContract.make('TreasuryVault', Contract);
      const compiledContract = CompiledContract.withVacantWitnesses(baseContract);

      setStatus('Submitting ZK proof transaction to 1AM wallet for signing...');

      const deployed = await deployContract(providers as any, {
        compiledContract: compiledContract as any,
        args: [1_000_000n],
        privateStateKey: 'treasuryVaultPrivateState',
        initialPrivateState: {},
      });

      const addr = deployed.deployTxData?.public?.contractAddress || (deployed as any).contractAddress || 'Confirmed on-chain';
      const hash = deployed.deployTxData?.public?.txHash || (deployed as any).txHash || '';

      setContractAddress(addr);
      setTxHash(hash);
      setStatus('Vault deployed successfully on Midnight Preprod!');
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
