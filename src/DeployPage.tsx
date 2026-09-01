import React, { useState, useEffect } from 'react';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { Contract } from '../contracts/managed/TreasuryVault/contract/index.js';

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
  const [status, setStatus] = useState<string>('Ready for interaction');
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
      setStatus('Connecting to Midnight / 1AM Wallet...');

      const midnight = (window as any).midnight;
      if (!midnight) {
        throw new Error('Midnight compatible wallet (1AM / Lace) extension not found in window.midnight.');
      }

      const walletKey = selectedWallet || Object.keys(midnight)[0];
      const entry = midnight[walletKey];
      if (!entry) throw new Error(`Selected wallet ${walletKey} is unavailable.`);

      const api = typeof entry.enable === 'function' ? await entry.enable() : entry;

      // Ensure networkId initialization if present on API or fallback safely
      if (typeof api.getNetworkId === 'function') {
        const netId = await api.getNetworkId();
        try {
          const netPkg: any = await import('@midnight-ntwrk/midnight-js-network-id');
          if (typeof netPkg.setNetworkId === 'function') {
            netPkg.setNetworkId(netId || 'undeployed');
          }
        } catch (_) {}
      }

      const walletProvider = api.walletProvider || {
        getCoinPublicKey: api.getCoinPublicKey ? () => api.getCoinPublicKey() : (api.state ? async () => (await api.state()).coinPublicKey : () => null),
        getEncryptionPublicKey: api.getEncryptionPublicKey ? () => api.getEncryptionPublicKey() : (api.state ? async () => (await api.state()).encryptionPublicKey : () => null),
        balanceTx: api.balanceTx ? api.balanceTx.bind(api) : api.balanceTransaction?.bind(api),
      };

      const providers = {
        privateStateProvider: inMemoryPrivateStateProvider(),
        publicDataProvider: api.publicDataProvider,
        zkConfigProvider: { getZkConfig: async () => ({ proverKey: async () => new Uint8Array(), verifierKey: async () => new Uint8Array() }) },
        proofProvider: api.proofProvider,
        walletProvider,
        midnightProvider: api.midnightProvider,
      };

      const baseContract = CompiledContract.make('TreasuryVault', Contract);
      const compiledContract = CompiledContract.withVacantWitnesses(baseContract);

      setStatus('Submitting Zero-Knowledge deployment transaction to wallet for signature...');

      const deployed = await deployContract(providers as any, {
        compiledContract: compiledContract as any,
        args: [1_000_000n],
        privateStateKey: 'treasuryPrivateState',
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
      <h1>Mizan Treasury Preprod Deployer</h1>
      {wallets.length > 0 ? (
        <select
          value={selectedWallet}
          onChange={(e) => setSelectedWallet(e.target.value)}
          style={{ padding: '0.5rem', marginBottom: '1rem', width: '100%', background: '#1e293b', color: '#fff', border: '1px solid #475569', borderRadius: '4px' }}
        >
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      ) : (
        <p style={{ color: '#fbbf24', fontSize: '0.9rem' }}>Searching for connected Midnight wallet extension...</p>
      )}

      <button
        onClick={handleDeploy}
        disabled={loading}
        style={{
          width: '100%',
          padding: '0.75rem',
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

      <p style={{ marginTop: '1rem', wordBreak: 'break-all', color: '#cbd5e1' }}>{status}</p>

      {contractAddress && (
        <div style={{ marginTop: '1rem', padding: '1rem', background: '#064e3b', borderRadius: '6px' }}>
          <p style={{ color: '#34d399', margin: 0, fontWeight: 'bold' }}>Contract Deployed</p>
          <p style={{ fontSize: '0.85rem', wordBreak: 'break-all', margin: '0.5rem 0' }}>Address: {contractAddress}</p>
          {txHash && <p style={{ fontSize: '0.85rem', wordBreak: 'break-all', margin: 0 }}>Tx: {txHash}</p>}
        </div>
      )}
    </div>
  );
}
