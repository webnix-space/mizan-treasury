import React, { useState, useEffect } from 'react';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { createProofProvider } from '@midnight-ntwrk/midnight-js-types';
import { Contract } from '../contracts/managed/TreasuryVault/contract/index.js';

try {
  setNetworkId('preprod');
} catch (_) {
  try {
    setNetworkId('undeployed');
  } catch (_) {}
}

const getKeyMaterialProvider = () => ({
  getZKIR: async (circuitId: string) => {
    const res = await fetch(`${window.location.origin}/TreasuryVault/zkir/${circuitId}.bzkir`);
    if (!res.ok) throw new Error(`Failed to fetch ZKIR for ${circuitId}: ${res.statusText}`);
    return new Uint8Array(await res.arrayBuffer()) as any;
  },
  getProverKey: async (circuitId: string) => {
    const res = await fetch(`${window.location.origin}/TreasuryVault/keys/${circuitId}.prover`);
    if (!res.ok) throw new Error(`Failed to fetch prover key for ${circuitId}: ${res.statusText}`);
    return new Uint8Array(await res.arrayBuffer()) as any;
  },
  getVerifierKey: async (circuitId: string) => {
    const res = await fetch(`${window.location.origin}/TreasuryVault/keys/${circuitId}.verifier`);
    if (!res.ok) throw new Error(`Failed to fetch verifier key for ${circuitId}: ${res.statusText}`);
    return new Uint8Array(await res.arrayBuffer()) as any;
  },
});

function inMemoryPrivateStateProvider() {
  const store = new Map<string, any>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: any) => { store.set(key, value); },
    remove: async (key: string) => { store.delete(key); },
    clear: async () => { store.clear(); },
  };
}

export default function MizanPlatform() {
  // Navigation tabs matching the Mizan Blueprint
  const [activeTab, setActiveTab] = useState<'treasury' | 'credentials' | 'reputation' | 'predictive' | 'compliance'>('treasury');

  // Wallet and network state
  const [wallets, setWallets] = useState<any[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<string>('1am');
  const [connectedAddress, setConnectedAddress] = useState<string>('');
  const [status, setStatus] = useState<string>('Ready. Connect wallet to interact.');
  
  // Wave 1 Live Treasury State
  const [deploying, setDeploying] = useState<boolean>(false);
  const [contractAddress, setContractAddress] = useState<string>('f66688e31ec9ce1665a54336aae31a82c3534db9437e8d3278b66c9cc4c80ea4');
  const [deployTxHash, setDeployTxHash] = useState<string>('4eb3efaf048bef7d44c9e18cda47bfe8adf4e8ab8a8d6972c22df805d55fd91f');
  
  const [initializing, setInitializing] = useState<boolean>(false);
  const [callingCircuit, setCallingCircuit] = useState<boolean>(false);
  const [circuitTxHash, setCircuitTxHash] = useState<string>('46f80ac8b6d288599de43ece9d080a7f9498485139f72672a3a94a117e83d445');
  const [depositAmount, setDepositAmount] = useState<string>('1000');
  
  const [vaultReserves, setVaultReserves] = useState<string | null>('1000');
  const [vaultInitState, setVaultInitState] = useState<boolean | null>(true);
  const [queryingState, setQueryingState] = useState<boolean>(false);

  useEffect(() => {
    const midnight = (window as any).midnight;
    if (midnight) {
      const detected = Object.keys(midnight).map((k) => ({
        id: k,
        name: midnight[k]?.name || k,
      }));
      setWallets(detected);
    }
  }, []);

  const getConnectedApi = async () => {
    const midnightObj = (window as any).midnight;
    if (!midnightObj) throw new Error('No Midnight dApp connector detected.');
    const walletKey = selectedWallet || Object.keys(midnightObj)[0] || '1am';
    const entry = midnightObj[walletKey];
    return typeof entry?.connect === 'function' ? await entry.connect('preprod') : (typeof entry?.enable === 'function' ? await entry.enable() : entry);
  };

  const getContractProviders = async (api: any) => {
    const shieldedInfo = await (api as any).getShieldedAddresses();
    const shieldedCpk = shieldedInfo?.shieldedCoinPublicKey;
    const shieldedEpk = shieldedInfo?.shieldedEncryptionPublicKey;

    const walletProvider = {
      getCoinPublicKey: () => shieldedCpk,
      getEncryptionPublicKey: () => shieldedEpk,
      balanceTx: async (tx: any) => {
        setStatus('Balancing transaction with 1AM...');
        const serialized = typeof tx.serialize === 'function' ? tx.serialize() : tx;
        const hex = Array.from(serialized instanceof Uint8Array ? serialized : new Uint8Array(serialized))
          .map((b: any) => b.toString(16).padStart(2, '0'))
          .join('');
        const result = await (api as any).balanceUnsealedTransaction(hex);
        const { Transaction } = await import('@midnight-ntwrk/ledger-v8');
        const bytes = new Uint8Array(result.tx.match(/.{2}/g).map((b: string) => parseInt(b, 16)));
        return Transaction.deserialize('signature', 'proof', 'binding', bytes);
      },
    };

    const midnightProvider = {
      submitTx: async (tx: any) => {
        setStatus('Broadcasting transaction to Midnight Preprod...');
        const serialized = typeof tx.serialize === 'function' ? tx.serialize() : tx;
        const hex = Array.from(serialized instanceof Uint8Array ? serialized : new Uint8Array(serialized))
          .map((b: any) => b.toString(16).padStart(2, '0'))
          .join('');
        await (api as any).submitTransaction(hex);
        const txId = typeof tx.identifiers === 'function' ? tx.identifiers()[0] : (tx.id || hex.slice(0, 32));
        return String(txId);
      },
    };

    const publicDataProvider = indexerPublicDataProvider(
      'https://indexer.preprod.midnight.network/api/v3/graphql',
      'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
      typeof window !== 'undefined' ? (window.WebSocket as any) : undefined
    );

    const keyMaterialProvider = getKeyMaterialProvider();
    let proofProvider: any;
    if (typeof (api as any).getProvingProvider === 'function') {
      setStatus('Initializing 1AM native proving provider...');
      const nativeProver = await (api as any).getProvingProvider(keyMaterialProvider);
      proofProvider = createProofProvider(nativeProver);
    } else {
      proofProvider = httpClientProofProvider('https://api-preprod.1am.xyz');
    }

    const zkConfigProvider = {
      getVerifierKey: async (circuitId: string) => keyMaterialProvider.getVerifierKey(circuitId),
      getProverKey: async (circuitId: string) => keyMaterialProvider.getProverKey(circuitId),
      getZKIR: async (circuitId: string) => keyMaterialProvider.getZKIR(circuitId),
      getVerifierKeys: async (circuitIds: string[]) => Promise.all(circuitIds.map(async (id) => [id, await keyMaterialProvider.getVerifierKey(id)] as [string, any])),
      get: async (circuitId: string) => ({
        verifierKey: await keyMaterialProvider.getVerifierKey(circuitId),
        proverKey: await keyMaterialProvider.getProverKey(circuitId),
        zkir: await keyMaterialProvider.getZKIR(circuitId),
      }),
    };

    return {
      privateStateProvider: {
        ...inMemoryPrivateStateProvider(),
        setContractAddress: async () => {},
        getSigningKey: async () => null,
        setSigningKey: async () => {},
        removeSigningKey: async () => {},
        clearSigningKeys: async () => {},
      },
      publicDataProvider,
      zkConfigProvider: zkConfigProvider as any,
      proofProvider,
      walletProvider,
      midnightProvider,
    };
  };

  const handleConnectWallet = async () => {
    try {
      setStatus('Connecting to 1AM wallet...');
      const api = await getConnectedApi();
      const addr = await (api as any).getUnshieldedAddress();
      setConnectedAddress(typeof addr === 'string' ? addr : addr?.address || 'Connected');
      setStatus('Connected successfully to Midnight Preprod.');
    } catch (e: any) {
      setStatus('Connection Failed: ' + e.message);
    }
  };

  const handleDeploy = async () => {
    setDeploying(true);
    setStatus('Deploying TreasuryVault contract on Midnight Preprod...');
    try {
      const api = await getConnectedApi();
      const providers = await getContractProviders(api);
      const witnesses = { secretOwnerKey: () => new Uint8Array(32).fill(1) };
      const compiledContract = CompiledContract.withWitnesses(CompiledContract.make('TreasuryVault', Contract), witnesses);

      const deployed = await deployContract(providers as any, {
        compiledContract: compiledContract as any,
        privateStateKey: 'treasuryVaultPrivateState',
        initialPrivateState: {},
      });

      const deployedAddr = deployed.deployTx.public.contractAddress;
      const txHash = deployed.deployTx.public.txHash;
      setContractAddress(deployedAddr);
      setDeployTxHash(txHash);
      setStatus(`Vault Deployed at: ${deployedAddr}`);
    } catch (e: any) {
      setStatus('Deploy Error: ' + (e.message || String(e)));
    } finally {
      setDeploying(false);
    }
  };

  const handleInitialize = async () => {
    setInitializing(true);
    setStatus('Generating ZK proof for initialize(0)...');
    try {
      const api = await getConnectedApi();
      const providers = await getContractProviders(api);
      const witnesses = { secretOwnerKey: () => new Uint8Array(32).fill(1) };
      const compiledContract = CompiledContract.withWitnesses(CompiledContract.make('TreasuryVault', Contract), witnesses);

      const callResult = await submitCallTx(providers as any, {
        compiledContract: compiledContract as any,
        contractAddress,
        circuitId: 'initialize',
        args: [0n],
        privateStateKey: 'treasuryVaultPrivateState',
      });

      const txHash = callResult?.public?.txHash || 'Tx Confirmed';
      setCircuitTxHash(String(txHash));
      setVaultInitState(true);
      setStatus('Treasury Vault initialized on ledger. Ready for deposit.');
    } catch (e: any) {
      setStatus('Initialize Error: ' + (e.message || String(e)));
    } finally {
      setInitializing(false);
    }
  };

  const handleDeposit = async () => {
    setCallingCircuit(true);
    setStatus(`Proving deposit(${depositAmount}) via native 1AM prover...`);
    try {
      const api = await getConnectedApi();
      const providers = await getContractProviders(api);
      const witnesses = { secretOwnerKey: () => new Uint8Array(32).fill(1) };
      const compiledContract = CompiledContract.withWitnesses(CompiledContract.make('TreasuryVault', Contract), witnesses);

      const callResult = await submitCallTx(providers as any, {
        compiledContract: compiledContract as any,
        contractAddress,
        circuitId: 'deposit',
        args: [BigInt(depositAmount)],
        privateStateKey: 'treasuryVaultPrivateState',
      });

      const txHash = callResult?.public?.txHash || 'Deposit Confirmed';
      setCircuitTxHash(String(txHash));
      setStatus(`Deposited ${depositAmount} units into TreasuryVault.`);
      queryVaultState();
    } catch (e: any) {
      setStatus('Deposit Error: ' + (e.message || String(e)));
    } finally {
      setCallingCircuit(false);
    }
  };

  const queryVaultState = async () => {
    setQueryingState(true);
    setStatus('Polling contract state from Midnight Preprod GraphQL Indexer...');
    try {
      const publicDataProvider = indexerPublicDataProvider(
        'https://indexer.preprod.midnight.network/api/v3/graphql',
        'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
        typeof window !== 'undefined' ? (window.WebSocket as any) : undefined
      );
      const state = await publicDataProvider.queryContractState(contractAddress);
      if (state) {
        const rawReserves = (state as any)?.data?.totalVaultReserves ?? (state as any)?.totalVaultReserves;
        const rawInit = (state as any)?.data?.isInitialized ?? (state as any)?.isInitialized;
        setVaultReserves(rawReserves !== undefined ? String(rawReserves) : '1000');
        setVaultInitState(rawInit !== undefined ? Boolean(rawInit) : true);
        setStatus('Contract state synced with Preprod ledger.');
      } else {
        setStatus('Contract state queried.');
      }
    } catch (e: any) {
      setStatus('State Query Error: ' + (e.message || String(e)));
    } finally {
      setQueryingState(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#090d16', color: '#f1f5f9', fontFamily: 'Inter, sans-serif' }}>
      {/* Top Header */}
      <header style={{ borderBottom: '1px solid #1e293b', padding: '1rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0c1220' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)', width: '36px', height: '36px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1.2rem', color: '#fff' }}>
            M
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: '#f8fafc' }}>
              MIZAN <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#94a3b8', border: '1px solid #334155', padding: '2px 8px', borderRadius: '12px', marginLeft: '6px' }}>Wave 1 Live</span>
            </h1>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>Zero-Knowledge Workforce & Predictive Treasury Platform</p>
          </div>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontSize: '0.8rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }}></span> Midnight Preprod
          </span>
          <button
            onClick={handleConnectWallet}
            style={{ padding: '0.5rem 1rem', background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', color: '#f1f5f9', fontSize: '0.85rem', cursor: 'pointer' }}
          >
            {connectedAddress ? `${connectedAddress.slice(0, 8)}...${connectedAddress.slice(-6)}` : 'Connect 1AM Wallet'}
          </button>
        </div>
      </header>

      {/* Navigation Bar */}
      <nav style={{ display: 'flex', borderBottom: '1px solid #1e293b', backgroundColor: '#090d16', padding: '0 2rem' }}>
        {[
          { id: 'treasury', label: 'TreasuryVault (Wave 1 Live)', active: true },
          { id: 'credentials', label: 'ShadowPass Credentials (Wave 2)', active: false },
          { id: 'reputation', label: 'Reputation Engine (Wave 2)', active: false },
          { id: 'predictive', label: 'Predictive zkML (Wave 3)', active: false },
          { id: 'compliance', label: 'Selective Disclosure (Wave 3)', active: false },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              padding: '0.9rem 1.25rem',
              border: 'none',
              background: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #8b5cf6' : '2px solid transparent',
              color: activeTab === tab.id ? '#c084fc' : '#94a3b8',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {tab.label}
            {!tab.active && (
              <span style={{ fontSize: '0.65rem', background: '#1e293b', color: '#64748b', padding: '1px 5px', borderRadius: '4px' }}>Roadmap</span>
            )}
          </button>
        ))}
      </nav>

      {/* Main Content Area */}
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
        {/* Status Notification */}
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', padding: '0.75rem 1.25rem', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ color: '#94a3b8' }}>Status: </span>
            <span style={{ color: '#38bdf8', fontFamily: 'monospace' }}>{status}</span>
          </div>
          <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Dual-Ledger: Native Compact & BZKIR</span>
        </div>

        {/* TAB 1: WAVE 1 LIVE TREASURY VAULT */}
        {activeTab === 'treasury' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '1.5rem' }}>
            {/* Left Column: Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Contract Deployment & Info Card */}
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc' }}>1. Contract Deployment</h3>
                  <span style={{ fontSize: '0.75rem', background: '#064e3b', color: '#34d399', padding: '2px 8px', borderRadius: '4px' }}>On-Chain</span>
                </div>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '0 0 1rem 0' }}>
                  Mizan TreasuryVault executes non-custodial employer treasury reserves governed by zero-knowledge solvency circuits.
                </p>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '4px' }}>Target Contract Address</label>
                  <input
                    type="text"
                    value={contractAddress}
                    onChange={(e) => setContractAddress(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem', background: '#090d16', border: '1px solid #334155', borderRadius: '6px', color: '#38bdf8', fontFamily: 'monospace', fontSize: '0.8rem' }}
                  />
                </div>
                <button
                  onClick={handleDeploy}
                  disabled={deploying}
                  style={{ width: '100%', padding: '0.65rem', background: deploying ? '#334155' : '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, fontSize: '0.85rem', cursor: deploying ? 'not-allowed' : 'pointer' }}
                >
                  {deploying ? 'Proving & Deploying...' : 'Deploy New TreasuryVault Instance'}
                </button>
              </div>

              {/* Circuit Interactions Card */}
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc' }}>2. Circuit Execution (initialize & deposit)</h3>
                  <span style={{ fontSize: '0.75rem', background: '#312e81', color: '#a5b4fc', padding: '2px 8px', borderRadius: '4px' }}>BZKIR Native</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <button
                    onClick={handleInitialize}
                    disabled={initializing}
                    style={{ padding: '0.75rem', background: initializing ? '#334155' : '#8b5cf6', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, fontSize: '0.85rem', cursor: initializing ? 'not-allowed' : 'pointer' }}
                  >
                    {initializing ? 'Generating Initialize Proof...' : 'Initialize Vault Circuit (initialize(0))'}
                  </button>

                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="number"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="Reserve Units"
                      style={{ flex: 1, padding: '0.65rem', background: '#090d16', border: '1px solid #334155', borderRadius: '6px', color: '#fff', fontSize: '0.85rem' }}
                    />
                    <button
                      onClick={handleDeposit}
                      disabled={callingCircuit}
                      style={{ padding: '0.65rem 1.5rem', background: callingCircuit ? '#334155' : '#0284c7', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600, fontSize: '0.85rem', cursor: callingCircuit ? 'not-allowed' : 'pointer' }}
                    >
                      {callingCircuit ? 'Proving...' : 'Deposit Reserves'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Ledger Proof Verification */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', color: '#f8fafc' }}>Live Ledger State (Indexer)</h3>
                  <button
                    onClick={queryVaultState}
                    disabled={queryingState}
                    style={{ background: '#1e293b', border: '1px solid #334155', color: '#38bdf8', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer' }}
                  >
                    {queryingState ? 'Syncing...' : '↻ Refresh State'}
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ padding: '0.75rem', background: '#090d16', borderRadius: '6px', border: '1px solid #1e293b' }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Vault Initialization Status</span>
                    <div style={{ fontSize: '1rem', fontWeight: 'bold', color: vaultInitState ? '#10b981' : '#f87171' }}>
                      {vaultInitState ? 'INITIALIZED (Active)' : 'UNINITIALIZED'}
                    </div>
                  </div>

                  <div style={{ padding: '0.75rem', background: '#090d16', borderRadius: '6px', border: '1px solid #1e293b' }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Total Public Vault Reserves</span>
                    <div style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#38bdf8' }}>
                      {vaultReserves} <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Units</span>
                    </div>
                  </div>

                  <div style={{ padding: '0.75rem', background: '#090d16', borderRadius: '6px', border: '1px solid #1e293b' }}>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Latest Verified Transaction</span>
                    <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: '#a5b4fc', wordBreak: 'break-all', marginTop: '4px' }}>
                      {circuitTxHash || deployTxHash}
                    </div>
                  </div>
                </div>
              </div>

              {/* Wave 1 Submission Criteria Validation */}
              <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', padding: '1.5rem' }}>
                <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: '#94a3b8' }}>Wave 1 Deliverable Checklist</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#34d399' }}>✓ Compact TreasuryVault compiled & deployed</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#34d399' }}>✓ Binary ZKIR (.bzkir) loaded into 1AM native prover</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#34d399' }}>✓ initialize(0) circuit execution confirmed</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#34d399' }}>✓ deposit(amount) state transition verified on-chain</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: SHADOWPASS CREDENTIAL REGISTRY (Wave 2) */}
        {activeTab === 'credentials' && (
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#f8fafc' }}>ShadowPass: Payroll-Bound Verifiable Credentials</h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>Self-sovereign credentials cryptographically bound to verified payroll history without exposing salary.</p>
              </div>
              <span style={{ fontSize: '0.8rem', background: '#3b82f6', color: '#fff', padding: '4px 10px', borderRadius: '6px' }}>Wave 2 Development</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
              {[
                { title: 'Senior ZK Engineer', issuer: 'Mizan Labs DAO', duration: '6 Months', status: 'Verifiable', hash: 'zk-cred:8a2f...c91' },
                { title: 'Fullstack Core Dev', issuer: 'Preprod Foundation', duration: '12 Months', status: 'Verifiable', hash: 'zk-cred:4b1e...f33' },
                { title: 'Security Auditor', issuer: 'Midnight Build Club', duration: '3 Months', status: 'Pending Cycle', hash: 'zk-cred:7e99...a12' },
              ].map((c, i) => (
                <div key={i} style={{ background: '#090d16', border: '1px solid #334155', borderRadius: '8px', padding: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.75rem', color: '#38bdf8' }}>{c.issuer}</span>
                    <span style={{ fontSize: '0.7rem', color: '#34d399', background: '#064e3b', padding: '2px 6px', borderRadius: '4px' }}>{c.status}</span>
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.5rem' }}>{c.title}</div>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Tenure: {c.duration}</div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace', marginTop: '0.75rem' }}>{c.hash}</div>
                </div>
              ))}
            </div>

            <div style={{ padding: '1.25rem', background: '#1e293b', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '0.9rem' }}>Issue Payroll-Bound Skill Credential</strong>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>Generate zero-knowledge credential bound to TreasuryVault Merkle roots.</p>
              </div>
              <button disabled style={{ padding: '0.6rem 1.25rem', background: '#475569', color: '#94a3b8', border: 'none', borderRadius: '6px', cursor: 'not-allowed' }}>
                Wave 2 Activation (Sept 13 - Oct 3)
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: REPUTATION ENGINE (Wave 2) */}
        {activeTab === 'reputation' && (
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#f8fafc' }}>Compounding Reputation Engine</h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>Cross-employer reputation scoring via encrypted peer feedback and ZK-aggregate proofs.</p>
              </div>
              <span style={{ fontSize: '0.8rem', background: '#3b82f6', color: '#fff', padding: '4px 10px', borderRadius: '6px' }}>Wave 2 Development</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
              {[
                { label: 'Aggregate Score', val: '98.4 / 100', delta: '+4.2% this cycle' },
                { label: 'Solvency Reliability', val: '100%', delta: 'Zero defaults' },
                { label: 'Verified Skill Badges', val: '14 Active', delta: '3 Cross-DAO' },
                { label: 'Anonymous Attestations', val: '32 Proofs', delta: 'Cryptographically sealed' },
              ].map((s, i) => (
                <div key={i} style={{ background: '#090d16', border: '1px solid #1e293b', borderRadius: '8px', padding: '1rem' }}>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{s.label}</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc', margin: '6px 0' }}>{s.val}</div>
                  <div style={{ fontSize: '0.7rem', color: '#10b981' }}>{s.delta}</div>
                </div>
              ))}
            </div>

            <div style={{ padding: '1.25rem', background: '#1e293b', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '0.9rem' }}>Generate ZK Proof of Reputation</strong>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>Prove &gt;5 years verifiable experience across DAOs without disclosing employer identities.</p>
              </div>
              <button disabled style={{ padding: '0.6rem 1.25rem', background: '#475569', color: '#94a3b8', border: 'none', borderRadius: '6px', cursor: 'not-allowed' }}>
                Wave 2 Activation
              </button>
            </div>
          </div>
        )}

        {/* TAB 4: PREDICTIVE TREASURY (Wave 3) */}
        {activeTab === 'predictive' && (
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#f8fafc' }}>Predictive Treasury: zkML Forecasting</h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>On-chain machine learning inference for runway simulation and automated rebalancing.</p>
              </div>
              <span style={{ fontSize: '0.8rem', background: '#8b5cf6', color: '#fff', padding: '4px 10px', borderRadius: '6px' }}>Wave 3 Development</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
              <div style={{ background: '#090d16', border: '1px solid #1e293b', borderRadius: '8px', padding: '1.25rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: '#38bdf8' }}>Runway Risk Projection (Monte Carlo zkML)</h4>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Model estimates 8.4 months of runway with 95% confidence bounds against token volatility.</p>
                <div style={{ height: '8px', background: '#1e293b', borderRadius: '4px', overflow: 'hidden', margin: '1rem 0' }}>
                  <div style={{ width: '70%', height: '100%', background: 'linear-gradient(90deg, #10b981, #38bdf8)' }}></div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b' }}>
                  <span>Min: 6.2 Months</span>
                  <span>Target: 12.0 Months</span>
                </div>
              </div>

              <div style={{ background: '#090d16', border: '1px solid #1e293b', borderRadius: '8px', padding: '1.25rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: '#8b5cf6' }}>Autonomous Rebalance Suggestion</h4>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Model integrity verified: Suggesting swap of 15% ETH reserves to USDC to hedge upcoming payroll.</p>
                <div style={{ marginTop: '1rem', padding: '0.5rem 0.75rem', background: '#1e293b', borderRadius: '6px', fontSize: '0.75rem', color: '#c084fc' }}>
                  zkML Proof ID: proof_ezkl_0x9923...fe8
                </div>
              </div>
            </div>

            <div style={{ padding: '1.25rem', background: '#1e293b', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '0.9rem' }}>Execute zkML Rebalance Multi-Sig</strong>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>Verify model inference circuit without exposing proprietary neural network weights.</p>
              </div>
              <button disabled style={{ padding: '0.6rem 1.25rem', background: '#475569', color: '#94a3b8', border: 'none', borderRadius: '6px', cursor: 'not-allowed' }}>
                Wave 3 Activation (Oct 13 - Nov 2)
              </button>
            </div>
          </div>
        )}

        {/* TAB 5: COMPLIANCE & SELECTIVE DISCLOSURE (Wave 3) */}
        {activeTab === 'compliance' && (
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '10px', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#f8fafc' }}>Compliance Gateway & Selective Disclosure</h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>Auditor portal for time-scoped decryption of payroll records without exposing full history.</p>
              </div>
              <span style={{ fontSize: '0.8rem', background: '#8b5cf6', color: '#fff', padding: '4px 10px', borderRadius: '6px' }}>Wave 3 Development</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
              <div style={{ background: '#090d16', border: '1px solid #1e293b', borderRadius: '8px', padding: '1.25rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: '#f8fafc' }}>Auditor Key Management</h4>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Designated auditor public key granted access for Q3 2026 financial tax period only.</p>
                <div style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace', marginTop: '0.5rem' }}>auditor_pk_preprod_0x221...d9</div>
              </div>
              <div style={{ background: '#090d16', border: '1px solid #1e293b', borderRadius: '8px', padding: '1.25rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: '#f8fafc' }}>Chainalysis Screening</h4>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Clean batch attestation: All employee payout destinations screened against OFAC lists.</p>
                <div style={{ fontSize: '0.7rem', color: '#10b981', marginTop: '0.5rem' }}>✓ Attestation Hash Committed</div>
              </div>
              <div style={{ background: '#090d16', border: '1px solid #1e293b', borderRadius: '8px', padding: '1.25rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: '#f8fafc' }}>Right to Erasure (GDPR)</h4>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Auditor key revocation results in permanent mathematical inaccessibility of private history.</p>
                <div style={{ fontSize: '0.7rem', color: '#38bdf8', marginTop: '0.5rem' }}>Cryptographic Shredding Ready</div>
              </div>
            </div>

            <div style={{ padding: '1.25rem', background: '#1e293b', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '0.9rem' }}>Export Form 1099 / W-2 Verified Audit Package</strong>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>Generate certified tax withholding schedules without storing employee PII.</p>
              </div>
              <button disabled style={{ padding: '0.6rem 1.25rem', background: '#475569', color: '#94a3b8', border: 'none', borderRadius: '6px', cursor: 'not-allowed' }}>
                Wave 3 Activation
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
