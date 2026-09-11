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

      setActiveStep('Reading addresses...');
      setStatus('Step 2: Deriving keys from shielded address...');

      const shieldedRaw = typeof api.getShieldedAddresses === 'function' ? await api.getShieldedAddresses() : null;
      const shieldedAddr = extractString(shieldedRaw);

      if (!shieldedAddr) {
        throw new Error('Could not retrieve shielded address from 1AM.');
      }

      const derived = deriveKeysFromShieldedAddress(shieldedAddr);
      const coinPk = derived.cpk;
      const encPk = derived.epk;

      setDiag(`CPK: ${coinPk.slice(0, 24)}...`);

      // Official Preprod Infrastructure
      const INDEXER_HTTP = 'https://indexer.preprod.midnight.network/api/v3/graphql';
      const INDEXER_WS = 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws';
      const PROOF_SERVER = 'https://api-preprod.1am.xyz';

      const nativeWs = typeof window !== 'undefined' ? (window.WebSocket as any) : undefined;
      
      // Use 1AM's native public provider if attached, otherwise our indexer
      const publicDataProvider = api.publicDataProvider || indexerPublicDataProvider(INDEXER_HTTP, INDEXER_WS, nativeWs);
      const proofProvider = httpClientProofProvider('https://26f42cf1466035.lhr.life');

      const walletProvider = {
        coinPublicKey: coinPk,
        encryptionPublicKey: encPk,
        getCoinPublicKey: () => coinPk,
        getEncryptionPublicKey: () => encPk,
        balanceTx: async (tx: any) => {
          setActiveStep('Balancing transaction with 1AM...');
          setStatus('Step 3a: Balancing transaction...');
          if (typeof api.balanceUnsealedTransaction === 'function') {
            try {
              const res = await api.balanceUnsealedTransaction(tx);
              if (res) return res;
            } catch (e) { console.warn('balanceUnsealedTransaction error:', e); }
          }
          if (typeof api.balanceSealedTransaction === 'function') {
            try {
              const res = await api.balanceSealedTransaction(tx);
              if (res) return res;
            } catch (e) { console.warn('balanceSealedTransaction error:', e); }
          }
          if (typeof api.balanceTx === 'function') {
            try { return await api.balanceTx(tx); } catch (_) {}
          }
          return tx;
        },
      };
      const midnightProvider = {
        submitTx: async (tx: any) => {
          setActiveStep('Submitting transaction to Preprod gateway...');
          setStatus('Step 3b: Submitting via 1AM gateway...');

          // Direct 1AM API submission
          if (typeof (api as any).submitTx === 'function') {
            const txId = await (api as any).submitTx(tx);
            if (txId) return typeof txId === 'string' ? txId : (txId.txHash || txId.id || String(txId));
          }

          if (typeof (api as any).submitTransaction === 'function') {
            const txId = await (api as any).submitTransaction(tx);
            if (txId) return typeof txId === 'string' ? txId : (txId.txHash || txId.id || String(txId));
          }

          // In case 1AM attached a midnightProvider directly
          if ((api as any).midnightProvider && typeof (api as any).midnightProvider.submitTx === 'function') {
            return await (api as any).midnightProvider.submitTx(tx);
          }

          throw new Error('1AM wallet did not provide a valid submitTx method.');
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
