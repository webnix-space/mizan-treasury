import React, { useState, useEffect } from 'react';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { Contract } from '../contracts/managed/TreasuryVault/contract/index.js';

// Top-level Network ID initialization for Midnight Preprod
try {
  setNetworkId('testnet');
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

// Safely extract a pure string key from any wallet payload format
function extractStringKey(val: any): string | null {
  if (!val) return null;
  if (typeof val === 'string' && val.trim().length > 0) return val.trim();
  if (typeof val === 'object') {
    if (typeof val.bech32 === 'string') return val.bech32;
    if (typeof val.address === 'string') return val.address;
    if (typeof val.data === 'string') return val.data;
    if (typeof val.value === 'string') return val.value;
    if (typeof val.key === 'string') return val.key;
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
  const [diagInfo, setDiagInfo] = useState<string>('');

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
      setDiagInfo('');
      setStatus('1/4: Requesting 1AM Wallet DApp connection...');

      const midnight = (window as any).midnight;
      if (!midnight) {
        throw new Error('Midnight compatible wallet extension not detected in window.midnight.');
      }

      const walletKey = selectedWallet || Object.keys(midnight)[0];
      const entry = midnight[walletKey];
      if (!entry) throw new Error(`Wallet ${walletKey} not available.`);

      // 1. Enable 1AM connector
      const api = typeof entry.enable === 'function' ? await entry.enable() : entry;

      // 2. Fetch full state from wallet API
      let state: any = {};
      if (typeof api.state === 'function') {
        state = await api.state();
      } else if (api.state && typeof api.state.subscribe === 'function') {
        state = await new Promise((resolve) => {
          const sub = api.state.subscribe({
            next: (s: any) => {
              if (s) {
                if (sub && sub.unsubscribe) sub.unsubscribe();
                resolve(s);
              }
            },
            error: () => resolve({}),
          });
          setTimeout(() => resolve({}), 2000);
        });
      } else if (api.state) {
        state = api.state;
      }

      // 3. Extract coin and encryption public keys
      let coinPk =
        extractStringKey(state?.coinPublicKey) ||
        extractStringKey(state?.address) ||
        extractStringKey(state?.bech32Address) ||
        extractStringKey(typeof api.getCoinPublicKey === 'function' ? await api.getCoinPublicKey() : null) ||
        extractStringKey(api.coinPublicKey) ||
        (api.walletProvider && extractStringKey(typeof api.walletProvider.getCoinPublicKey === 'function' ? await api.walletProvider.getCoinPublicKey() : null));

      let encPk =
        extractStringKey(state?.encryptionPublicKey) ||
        extractStringKey(state?.encPublicKey) ||
        extractStringKey(typeof api.getEncryptionPublicKey === 'function' ? await api.getEncryptionPublicKey() : null) ||
        extractStringKey(api.encryptionPublicKey) ||
        (api.walletProvider && extractStringKey(typeof api.walletProvider.getEncryptionPublicKey === 'function' ? await api.walletProvider.getEncryptionPublicKey() : null));

      // Fallback: If wallet only exposes addresses array
      if (!coinPk && typeof api.getAddresses === 'function') {
        const addrs = await api.getAddresses();
        if (addrs && addrs.length > 0) coinPk = extractStringKey(addrs[0]);
      }

      if (!coinPk) {
        const dump = JSON.stringify({ apiKeys: Object.keys(api), stateKeys: Object.keys(state) });
        setDiagInfo(`Wallet state dump: ${dump}`);
        throw new Error('1AM wallet did not return Bech32 coin public keys. Please open 1AM, ensure account is created/selected on Preprod, and unlock it.');
      }

      if (!encPk) encPk = coinPk;

      setDiagInfo(`Connected PK: ${coinPk.slice(0, 16)}...`);
      setStatus('2/4: Preparing ZK contract artifacts...');

      // 4. Wrap strictly typed wallet provider
      const walletProvider = {
        coinPublicKey: coinPk,
        encryptionPublicKey: encPk,
        getCoinPublicKey: async () => coinPk as string,
        getEncryptionPublicKey: async () => encPk as string,
        balanceTx: async (tx: any, ttl?: any) => {
          if (typeof api.balanceTx === 'function') return api.balanceTx(tx, ttl);
          if (typeof api.balanceTransaction === 'function') return api.balanceTransaction(tx, ttl);
          if (api.walletProvider && typeof api.walletProvider.balanceTx === 'function') {
            return api.walletProvider.balanceTx(tx, ttl);
          }
          return tx;
        },
      };

      const providers = {
        privateStateProvider: inMemoryPrivateStateProvider(),
        publicDataProvider: api.publicDataProvider,
        zkConfigProvider: api.zkConfigProvider || {
          getZkConfig: async () => ({ proverKey: async () => new Uint8Array(), verifierKey: async () => new Uint8Array() })
        },
        proofProvider: api.proofProvider,
        walletProvider,
        midnightProvider: api.midnightProvider || api,
      };

      const baseContract = CompiledContract.make('TreasuryVault', Contract);
      const compiledContract = CompiledContract.withVacantWitnesses(baseContract);

      setStatus('3/4: Generating witness proofs & waiting for 1AM wallet signature...');

      const deployed = await deployContract(providers as any, {
        compiledContract: compiledContract as any,
        args: [1_000_000n],
        privateStateKey: 'treasuryVaultPrivateState',
        initialPrivateState: {},
      });

      const addr = deployed.deployTxData?.public?.contractAddress || (deployed as any).contractAddress || 'Confirmed on Midnight Preprod';
      const hash = deployed.deployTxData?.public?.txHash || (deployed as any).txHash || '';

      setContractAddress(addr);
      setTxHash(hash);
      setStatus('4/4: Vault successfully deployed on-chain!');
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

      {diagInfo && (
        <p style={{ fontSize: '0.8rem', color: '#64748b', wordBreak: 'break-all' }}>{diagInfo}</p>
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
