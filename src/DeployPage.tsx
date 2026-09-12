import React, { useState, useEffect } from 'react';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { Contract } from '../contracts/managed/TreasuryVault/contract/index.js';
import { bech32, bech32m } from 'bech32';

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

function deriveKeysFromShieldedAddress(shieldedAddr: string) {
  const decoded = bech32m.decode(shieldedAddr as any, 150) || bech32.decode(shieldedAddr as any, 150);
  const bytes = bech32.fromWords(decoded.words);

  const cpkBytes = bytes.slice(0, 32);
  const epkBytes = bytes.slice(32, 64);

  const cpkWords = bech32.toWords(cpkBytes);
  const epkWords = bech32.toWords(epkBytes);

  const netPrefix = decoded.prefix.includes('preprod') ? '_preprod' : '';
  const cpk = bech32m.encode(`mn_shield-cpk${netPrefix}`, cpkWords, 150);
  const epk = bech32m.encode(`mn_shield-epk${netPrefix}`, epkWords, 150);

  return { cpk, epk };
}

export default function DeployPage() {
  const [status, setStatus] = useState<string>('Ready to deploy');
  const [wallets, setWallets] = useState<{ id: string; name: string }[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<string>('');
  const [contractAddress, setContractAddress] = useState<string>('');
  const [txHash, setTxHash] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [diag, setDiag] = useState<string>('');
  const [activeStep, setActiveStep] = useState<string>('');

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
      setActiveStep('Connecting to 1AM...');
      setStatus('Step 1: Connecting to 1AM wallet...');

      const midnight = (window as any).midnight;
      if (!midnight) {
        throw new Error('1AM wallet extension not detected.');
      }

      const walletKey = selectedWallet || Object.keys(midnight)[0];
      const entry = midnight[walletKey];
      if (!entry) throw new Error(`Wallet ${walletKey} not available.`);

      const api = typeof entry.connect === 'function' ? await entry.connect() : (typeof entry.enable === 'function' ? await entry.enable() : entry);

      setActiveStep('Reading wallet addresses and keys...');
      setStatus('Step 2: Reading wallet public credentials...');

      let coinPk = '';
      let encPk = '';

      if (typeof api.getCoinPublicKey === 'function') {
        try { coinPk = await api.getCoinPublicKey(); } catch (_) {}
      }
      if (typeof api.getEncryptionPublicKey === 'function') {
        try { encPk = await api.getEncryptionPublicKey(); } catch (_) {}
      }

      const shieldedRaw = typeof api.getShieldedAddresses === 'function' ? await api.getShieldedAddresses() : null;
      const shieldedAddr = extractString(shieldedRaw);

      if (shieldedAddr && (!coinPk || !encPk)) {
        const derived = deriveKeysFromShieldedAddress(shieldedAddr);
        coinPk = coinPk || derived.cpk;
        encPk = encPk || derived.epk;
      }

      const unshieldedRaw = typeof api.getUnshieldedAddresses === 'function'
        ? await api.getUnshieldedAddresses()
        : (typeof api.getUnshieldedAddress === 'function' ? await api.getUnshieldedAddress() : null);
      const unshieldedAddr = extractString(unshieldedRaw);

      setDiag(`Unshielded: ${unshieldedAddr ? unshieldedAddr.slice(0, 15) + '...' : 'detected'}`);

      // Official Preprod Infrastructure
      const INDEXER_HTTP = 'https://indexer.preprod.midnight.network/api/v3/graphql';
      const INDEXER_WS = 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws';
      const PROOF_SERVER = 'https://api-preprod.1am.xyz';

      const nativeWs = typeof window !== 'undefined' ? (window.WebSocket as any) : undefined;
      
      // Use 1AM's native public provider if attached, otherwise our indexer
      const publicDataProvider = api.publicDataProvider || indexerPublicDataProvider(INDEXER_HTTP, INDEXER_WS, nativeWs);
      const proofProvider = httpClientProofProvider(PROOF_SERVER);

      const walletProvider = {
        coinPublicKey: coinPk,
        encryptionPublicKey: encPk,
        getCoinPublicKey: () => coinPk,
        getEncryptionPublicKey: () => encPk,
        balanceTx: async (tx: any, newCoins?: any) => {
          setActiveStep('Balancing transaction with 1AM...');
          setStatus('Step 3a: Balancing transaction...');
          console.log('[1AM] Requesting balanceTx...');
          if (typeof api.balanceTx === 'function') {
            try {
              const res = await api.balanceTx(tx, newCoins);
              if (res) return res;
            } catch (e) { console.warn('balanceTx error, trying unsealed:', e); }
          }
          if (typeof api.balanceUnsealedTransaction === 'function') {
            try {
              const res = await api.balanceUnsealedTransaction(tx, newCoins);
              if (res) return res;
            } catch (e) { console.warn('balanceUnsealedTransaction error:', e); }
          }
          if (typeof api.balanceSealedTransaction === 'function') {
            try {
              const res = await api.balanceSealedTransaction(tx);
              if (res) return res;
            } catch (e) { console.warn('balanceSealedTransaction error:', e); }
          }
            try { return await api.balanceTx(tx); } catch (_) {}
          }
          return tx;
        },
        signTx: async (tx: any) => {
          setActiveStep('Awaiting signature in 1AM...');
          setStatus('Step 3a.2: Please confirm and sign the transaction in 1AM wallet...');
          console.log('[1AM] Triggering interactive signTx...');
          if (typeof (api as any).signTx === 'function') {
            return await (api as any).signTx(tx);
          }
          if (typeof (api as any).signTransaction === 'function') {
            return await (api as any).signTransaction(tx);
          }
          return tx;
        },
      };
      const midnightProvider = {
        submitTx: async (tx: any) => {
          setActiveStep('Broadcasting transaction to Preprod node...');
          setStatus('Step 3b: Submitting transaction directly to Preprod...');

          // 1. Serialize the transaction object to binary / hex
          let bytes: Uint8Array;
          if (tx instanceof Uint8Array) {
            bytes = tx;
          } else if (typeof tx?.serialize === 'function') {
            bytes = tx.serialize();
          } else if (tx?.bytes instanceof Uint8Array) {
            bytes = tx.bytes;
          } else if (typeof tx?.toBytes === 'function') {
            bytes = tx.toBytes();
          } else {
            bytes = new TextEncoder().encode(typeof tx === 'string' ? tx : JSON.stringify(tx));
          }

          const hexTx = Array.from(bytes, (b: number) => b.toString(16).padStart(2, '0')).join('');

          // 2. Submit directly to Midnight Preprod RPC endpoints (bypasses 1AM extension completely)
          const submitEndpoints = [
            'https://rpc.preprod.midnight.network',
            'https://indexer.preprod.midnight.network/api/v3/graphql',
            'https://preprod.midnight.network/api/v1/tx'
          ];

          // Try RPC JSON-RPC submit first
          try {
            const rpcRes = await fetch('https://rpc.preprod.midnight.network', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'submitTx',
                params: [hexTx]
              })
            });
            const rpcData = await rpcRes.json();
            if (rpcData?.result) return String(rpcData.result);
          } catch (e) {
            console.warn('Direct RPC submit failed, trying fallback indexer mutation:', e);
          }

          // Try GraphQL mutation fallback
          try {
            const gqlRes = await fetch('https://indexer.preprod.midnight.network/api/v3/graphql', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                query: 'mutation SubmitTx($tx: String!) { submitTransaction(transaction: $tx) }',
                variables: { tx: hexTx }
              })
            });
            const gqlData = await gqlRes.json();
            if (gqlData?.data?.submitTransaction) {
              return String(gqlData.data.submitTransaction);
            }
          } catch (e) {
            console.warn('Indexer mutation failed:', e);
          }

          // Fallback: If 1AM has a non-interactive background submit
          if (typeof (api as any).submitTx === 'function') {
            try {
              const res = await (api as any).submitTx(tx);
              if (res) return typeof res === 'string' ? res : (res.txHash || res.id || String(res));
            } catch (err) {
              console.warn('1AM submitTx failed:', err);
            }
          }

          throw new Error('Preprod node submission failed. Ensure network connectivity to preprod.midnight.network.');
        },
      };
      const providers = {
        privateStateProvider: inMemoryPrivateStateProvider(),
        publicDataProvider,
        zkConfigProvider: {
          getZkConfig: async (circuitId: string) => {
            const baseUrl = window.location.origin + '/TreasuryVault';
            const [proverRes, verifierRes] = await Promise.all([
              fetch(`${baseUrl}/${circuitId}.prover`),
              fetch(`${baseUrl}/${circuitId}.verifier`)
            ]);
            return {
              proverKey: async () => new Uint8Array(await proverRes.arrayBuffer()),
              verifierKey: async () => new Uint8Array(await verifierRes.arrayBuffer()),
            };
          }
        },
        proofProvider,
        walletProvider,
        midnightProvider,
      };

      const baseContract = CompiledContract.make('TreasuryVault', Contract);
      const compiledContract = CompiledContract.withVacantWitnesses(baseContract);

      setActiveStep('deployContract executing...');
      setStatus('Step 3: Generating circuit proof & submitting contract...');

      const ownerBytes = new Uint8Array(32);
      window.crypto.getRandomValues(ownerBytes);
      const initialBalance = 1_000_000n;

      const deployed = await deployContract(providers as any, {
        compiledContract: compiledContract as any,
        args: [],
        privateStateKey: 'treasuryVaultPrivateState',
        initialPrivateState: {},
      });

      const addr = deployed.deployTxData?.public?.contractAddress || (deployed as any).contractAddress || 'Confirmed on-chain';
      const hash = deployed.deployTxData?.public?.txHash || (deployed as any).txHash || '';

      setContractAddress(String(addr));
      setTxHash(String(hash));
      setStatus('Success! Treasury Vault successfully deployed on Midnight Preprod!');
      setActiveStep('Complete');
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

      {activeStep && (
        <p style={{ fontSize: '0.85rem', color: '#38bdf8' }}>Last trace: {activeStep}</p>
      )}

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
