import React, { useState, useEffect } from 'react';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { setNetworkId, NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { Contract } from '../contracts/managed/TreasuryVault/contract/index.js';

// Initialize network environment explicitly for Preprod
try {
  setNetworkId(NetworkId.TestNet);
} catch (e) {
  console.warn('Network ID setup:', e);
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

export default function DeployPage() {
  const [status, setStatus] = useState<string>('Detecting wallet...');
  const [wallets, setWallets] = useState<{ id: string; name: string }[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<string>('');
  const [contractAddress, setContractAddress] = useState<string>('');
  const [txHash, setTxHash] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [debugLog, setDebugLog] = useState<string>('');

  useEffect(() => {
    const midnight = (window as any).midnight;
    if (midnight) {
      const detected = Object.keys(midnight).map((key) => {
        const item = midnight[key];
        return {
          id: key,
          name: item?.name || key,
        };
      });
      setWallets(detected);
      if (detected.length > 0) {
        setSelectedWallet(detected[0].id);
        setStatus(`Found wallet: ${detected[0].name}`);
      }
    } else {
      setStatus('No window.midnight object found.');
    }
  }, []);

  const handleDeploy = async () => {
    try {
      setLoading(true);
      // Ensure Network ID is set right before execution
      setNetworkId(NetworkId.TestNet);

      const midnight = (window as any).midnight;
      if (!midnight) throw new Error('window.midnight is undefined.');

      const activeKey = selectedWallet || Object.keys(midnight)[0];
      const entry = midnight[activeKey];
      if (!entry) throw new Error(`Connector '${activeKey}' not found.`);

      setStatus(`Connecting to ${entry.name || activeKey}... Check extension window!`);
      
      const api = typeof entry.enable === 'function' ? await entry.enable() : entry;
      setDebugLog(`API initialized: ${Object.keys(api || {}).join(', ')}`);

      // Unpack Providers directly from 1AM / Lace connector
      const walletProvider = api.walletProvider || {
        getCoinPublicKey: api.getCoinPublicKey ? () => api.getCoinPublicKey() : (api.state ? async () => (await api.state()).coinPublicKey : () => null),
        getEncryptionPublicKey: api.getEncryptionPublicKey ? () => api.getEncryptionPublicKey() : (api.state ? async () => (await api.state()).encryptionPublicKey : () => null),
        balanceTx: api.balanceTx ? api.balanceTx.bind(api) : api.balanceTransaction?.bind(api),
      };

      const midnightProvider = api.midnightProvider || {
        submitTx: api.submitTx ? api.submitTx.bind(api) : api.submitTransaction?.bind(api),
      };

      const proofProvider = api.proofProvider || {
        proveTx: api.proveTx ? api.proveTx.bind(api) : api.proveTransaction?.bind(api),
      };

      const publicDataProvider = api.publicDataProvider || {
        queryContractState: api.queryContractState?.bind(api),
      };

      const zkConfig = {
        proverKey: async () => new Uint8Array(),
        verifierKey: async () => new Uint8Array(),
      };

      const providers = {
        privateStateProvider: inMemoryPrivateStateProvider(),
        publicDataProvider,
        zkConfigProvider: { getZkConfig: async () => zkConfig },
        proofProvider,
        walletProvider,
        midnightProvider,
      };

      setStatus('Proving & Deploying (1AM Fee Sponsorship Active)...');

      const baseContract = CompiledContract.make('TreasuryVault', Contract);
      const compiledContract = CompiledContract.withVacantWitnesses(baseContract);

      const ownerBytes = new Uint8Array(32);
      crypto.getRandomValues(ownerBytes);
      const initialBalance = 1_000_000n;

      const deployedContract = await deployContract(providers as any, {
        compiledContract: compiledContract as any,
        args: [ownerBytes, initialBalance],
        privateStateKey: 'treasuryVaultPrivateState',
        initialPrivateState: {},
      });

      const deployedAddress = deployedContract.deployTxData.public.contractAddress;
      const deployedTx = deployedContract.deployTxData.public.txHash;

      setContractAddress(deployedAddress);
      setTxHash(deployedTx);
      setStatus('Deployed Successfully on Midnight Preprod!');
    } catch (err: any) {
      console.error(err);
      setStatus(`Execution Error: ${err.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem', fontFamily: 'monospace', maxWidth: '650px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Mizan Treasury Preprod Deployer</h1>

      {wallets.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ marginRight: '0.5rem' }}>Select Provider:</label>
          <select 
            value={selectedWallet} 
            onChange={(e) => setSelectedWallet(e.target.value)}
            style={{ padding: '0.4rem', background: '#1e293b', color: '#fff', border: '1px solid #475569' }}
          >
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>{w.name} ({w.id.slice(0, 8)}...)</option>
            ))}
          </select>
        </div>
      )}
      
      <button 
        onClick={handleDeploy} 
        disabled={loading}
        style={{
          padding: '0.85rem 1.75rem',
          fontSize: '1rem',
          cursor: loading ? 'not-allowed' : 'pointer',
          background: '#3b82f6',
          color: '#ffffff',
          border: 'none',
          borderRadius: '6px',
          fontWeight: 'bold',
          marginBottom: '1.5rem',
          width: '100%'
        }}
      >
        {loading ? 'Deploying to Preprod...' : 'Deploy TreasuryVault'}
      </button>

      <div style={{ background: '#1e293b', padding: '1rem', borderRadius: '6px', marginBottom: '1rem', wordBreak: 'break-all' }}>
        <strong>Status:</strong> {status}
      </div>

      {debugLog && (
        <div style={{ background: '#0f172a', border: '1px solid #334155', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.85rem', color: '#94a3b8' }}>
          <strong>Debug:</strong> {debugLog}
        </div>
      )}

      {contractAddress && (
        <div style={{ background: '#064e3b', color: '#6ee7b7', padding: '1.25rem', borderRadius: '6px', wordBreak: 'break-all' }}>
          <p><strong>Contract Address:</strong><br />{contractAddress}</p>
          <p style={{ marginTop: '0.75rem' }}><strong>Transaction Hash:</strong><br />{txHash}</p>
        </div>
      )}
    </div>
  );
}
