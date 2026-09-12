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

      const apiMethods = Object.keys(api).filter(k => typeof (api as any)[k] === 'function').join(', ');
      setDiag(`Methods: ${apiMethods}`);
      console.log('1AM API methods:', Object.keys(api));

      // Official Preprod Infrastructure
      const INDEXER_HTTP = 'https://indexer.preprod.midnight.network/api/v3/graphql';
      const INDEXER_WS = 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws';
      const PROOF_SERVER = 'https://api-preprod.1am.xyz';

      const nativeWs = typeof window !== 'undefined' ? (window.WebSocket as any) : undefined;
      
      // Use 1AM's native public provider if attached, otherwise our indexer
      const publicDataProvider = api.publicDataProvider || indexerPublicDataProvider(INDEXER_HTTP, INDEXER_WS, nativeWs);
      const proofProvider = httpClientProofProvider(PROOF_SERVER);

      const shieldedInfo = await (api as any).getShieldedAddresses();
      const shieldedCpk = shieldedInfo?.shieldedCoinPublicKey || coinPk;
      const shieldedEpk = shieldedInfo?.shieldedEncryptionPublicKey || encPk;

      const walletProvider = {
        getCoinPublicKey: () => shieldedCpk,
        getEncryptionPublicKey: () => shieldedEpk,
        balanceTx: async (tx: any) => {
          setActiveStep('Balancing transaction with 1AM...');
          setStatus('Step 3a: 1AM ProofStation is balancing transaction and sponsoring gas...');
          console.log('[1AM] Serializing tx to hex for balanceUnsealedTransaction...');

          const serialized = typeof tx.serialize === 'function' ? tx.serialize() : tx;
          const hex = Array.from(serialized instanceof Uint8Array ? serialized : new Uint8Array(serialized))
            .map((b: any) => b.toString(16).padStart(2, '0'))
            .join('');

          const result = await (api as any).balanceUnsealedTransaction(hex);
          if (!result || !result.tx) {
            throw new Error('1AM balanceUnsealedTransaction returned empty transaction response.');
          }

          console.log('[1AM] Received balanced tx hex from 1AM, deserializing...');
          const { Transaction } = await import('@midnight-ntwrk/ledger-v8');
          const bytes = new Uint8Array(result.tx.match(/.{2}/g).map((b: string) => parseInt(b, 16)));
          return Transaction.deserialize('signature', 'proof', 'binding', bytes);
        },
      };

      const midnightProvider = {
        submitTx: async (tx: any) => {
          setActiveStep('Broadcasting transaction...');
          setStatus('Step 3b: Broadcasting transaction via 1AM...');
          console.log('[1AM] Serializing balanced tx to hex for submitTransaction...');

          const serialized = typeof tx.serialize === 'function' ? tx.serialize() : tx;
          const hex = Array.from(serialized instanceof Uint8Array ? serialized : new Uint8Array(serialized))
            .map((b: any) => b.toString(16).padStart(2, '0'))
            .join('');

          await (api as any).submitTransaction(hex);

          const txId = typeof tx.identifiers === 'function' ? tx.identifiers()[0] : (tx.id || hex.slice(0, 32));
          console.log('[1AM] Transaction successfully broadcasted! Tx ID:', txId);
          return String(txId);
        },
      };
      const providers = {
        privateStateProvider: {
          ...inMemoryPrivateStateProvider(),
          setContractAddress: async (address: string) => {
            console.log('[PrivateStateProvider] Contract address:', address);
          },
          getSigningKey: async (contractAddress: string) => {
            console.log('[PrivateStateProvider] getSigningKey for:', contractAddress);
            return null;
          },
          setSigningKey: async (contractAddress: string, key: any) => {
            console.log('[PrivateStateProvider] setSigningKey for:', contractAddress);
          },
          removeSigningKey: async (contractAddress: string) => {
            console.log('[PrivateStateProvider] removeSigningKey for:', contractAddress);
          },
          clearSigningKeys: async () => {
            console.log('[PrivateStateProvider] clearSigningKeys called');
          },
        },
        },
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
