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
      const midnight = (window as any).midnight;
      if (!midnight) throw new Error('Midnight/1AM wallet extension required.');

      const entry = midnight[selectedWallet] || midnight[Object.keys(midnight)[0]];
      const api = typeof entry.enable === 'function' ? await entry.enable() : entry;

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

      const deployed = await deployContract(providers as any, {
        compiledContract: compiledContract as any,
        args: [1_000_000n],
        privateStateKey: 'treasuryPrivateState',
        initialPrivateState: {},
      });

      setContractAddress(deployed.deployTxData.public.contractAddress);
      setTxHash(deployed.deployTxData.public.txHash);
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
      {wallets.length > 0 && (
        <select value={selectedWallet} onChange={(e) => setSelectedWallet(e.target.value)} style={{ padding: '0.5rem', marginBottom: '1rem', width: '100%', background: '#1e293b', color: '#fff' }}>
          {wallets.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      )}
      <button onClick={handleDeploy} disabled={loading} style={{ width: '100%', padding: '0.75rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold' }}>
        {loading ? 'Deploying...' : 'Deploy Production Vault'}
      </button>
      <p style={{ marginTop: '1rem', wordBreak: 'break-all' }}>{status}</p>
      {contractAddress && <p style={{ color: '#10b981' }}>Contract: {contractAddress}<br />Tx: {txHash}</p>}
    </div>
  );
}
