import { WebSocket } from 'ws';
(globalThis as any).WebSocket = WebSocket;

import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import * as Rx from 'rxjs';
import * as bip39 from 'bip39';
import { HDKey } from '@scure/bip32';
import { bech32m } from '@scure/base';

import {
  WalletFacade,
  ShieldedWallet,
  DustWallet,
  UnshieldedWallet,
  createKeystore,
  PublicKey,
  NoOpTransactionHistoryStorage,
} from '@midnight-ntwrk/wallet-sdk';

import * as ledger from '@midnight-ntwrk/midnight-js-protocol/ledger';

import { setNetworkId, getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/compact-js';

import { Contract } from '../contracts/managed/TreasuryVault/contract/index.js';

dotenv.config();

const networkId = process.env.NETWORK_ID || 'preprod';
setNetworkId(networkId);

const CONFIG = {
  indexer: process.env.INDEXER_URL || 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: process.env.INDEXER_WS_URL || 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node: process.env.NODE_URL || 'https://rpc.preprod.midnight.network',
  proofServer: 'https://proof-server.preprod.midnight.network',
};

function encodeBech32Key(type: string, rawBytes: Uint8Array, net: string): string {
  const hrp = net === 'mainnet' ? `mn_${type}` : `mn_${type}_${net}`;
  const words = bech32m.toWords(rawBytes);
  return bech32m.encode(hrp, words);
}

function derive1AMKeys(mnemonic: string) {
  const clean = mnemonic.trim();
  const seed = bip39.mnemonicToSeedSync(clean);
  const master = HDKey.fromMasterSeed(seed);

  const unshieldedNode = master.derive("m/44'/2400'/0'/0/0");
  if (!unshieldedNode.privateKey) throw new Error('Failed unshielded key derivation');

  const shieldedNode = master.derive("m/44'/2400'/0'/2/0");
  if (!shieldedNode.privateKey) throw new Error('Failed shielded key derivation');

  return {
    unshieldedPrivateKey: unshieldedNode.privateKey,
    shieldedPrivateKey: shieldedNode.privateKey,
    dustPrivateKey: unshieldedNode.privateKey,
  };
}

async function buildWallet(mnemonic: string) {
  const keys = derive1AMKeys(mnemonic);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys.shieldedPrivateKey);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys.dustPrivateKey);
  const unshieldedKeystore = createKeystore(keys.unshieldedPrivateKey, getNetworkId());

  const shieldedConfig = {
    networkId: getNetworkId(),
    indexerClientConnection: {
      indexerHttpUrl: CONFIG.indexer,
      indexerWsUrl: CONFIG.indexerWS,
    },
    provingServerUrl: new URL(CONFIG.proofServer),
    relayURL: new URL(CONFIG.node.replace(/^http/, 'ws')),
  };

  const unshieldedConfig = {
    networkId: getNetworkId(),
    indexerClientConnection: {
      indexerHttpUrl: CONFIG.indexer,
      indexerWsUrl: CONFIG.indexerWS,
    },
    txHistoryStorage: new NoOpTransactionHistoryStorage(),
  };

  const dustConfig = {
    ...shieldedConfig,
    costParameters: {
      additionalFeeOverhead: 0n,
      feeBlocksMargin: 5,
    },
  };

  const initialDustParams = ledger.LedgerParameters.initialParameters().dust;

  const wallet = await WalletFacade.init({
    configuration: { ...shieldedConfig, ...unshieldedConfig, ...dustConfig },
    shielded: (cfg: any) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg: any) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg: any) => DustWallet(cfg).startWithSecretKey(dustSecretKey, initialDustParams),
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);
  return { wallet, unshieldedKeystore, shieldedSecretKeys, dustSecretKey };
}

async function main() {
  console.log(`Starting TreasuryVault deployment on Midnight ${networkId}...`);

  if (!process.env.WALLET_SEED) {
    throw new Error('WALLET_SEED is missing in .env');
  }

  const { wallet, unshieldedKeystore, shieldedSecretKeys, dustSecretKey } = await buildWallet(process.env.WALLET_SEED);
  const activeAddress = unshieldedKeystore.getBech32Address();
  console.log(`Active Deployer Address: ${activeAddress}`);

  console.log('Synchronizing wallet state with indexer...');
  const walletState = await Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.filter((state: any) => {
        const hasUnshielded = state.unshielded?.balances && Object.keys(state.unshielded.balances).length > 0;
        const hasKeys = Boolean(state.shielded?.coinPublicKey) && Boolean(state.shielded?.encryptionPublicKey);
        return Boolean(hasKeys && hasUnshielded);
      })
    )
  );

  const rawCoinPkBytes = (walletState.shielded.coinPublicKey as any).data ?? walletState.shielded.coinPublicKey;
  const rawEncPkBytes = (walletState.shielded.encryptionPublicKey as any).data ?? walletState.shielded.encryptionPublicKey;

  const coinPk = encodeBech32Key('shield-cpk', new Uint8Array(rawCoinPkBytes), networkId);
  const encPk = encodeBech32Key('shield-epk', new Uint8Array(rawEncPkBytes), networkId);

  console.log(' - Shielded Coin PK:', coinPk);
  console.log(' - Shielded Enc PK:', encPk);

  const zkArtifactsDir = path.resolve(process.cwd(), 'contracts/managed/TreasuryVault');
  const zkConfigProvider = new NodeZkConfigProvider(zkArtifactsDir);
  const publicDataProvider = indexerPublicDataProvider(CONFIG.indexer, CONFIG.indexerWS);
  const proofProvider = httpClientProofProvider(CONFIG.proofServer, zkConfigProvider);

  const privateStateProvider = levelPrivateStateProvider({
    privateStateStoreName: 'mizan-treasury-private-state',
    signingKeyStoreName: 'mizan-treasury-signing-keys',
    accountId: 'preprod-deployer-account',
    privateStoragePasswordProvider: () => 'Mizan-Treasury-Secret-2026',
  });

  const walletProvider = {
    getCoinPublicKey: () => coinPk,
    getEncryptionPublicKey: () => encPk,
    balanceTx: async (tx: any) => {
      const ttl = new Date(Date.now() + 15 * 60 * 1000);
      const recipe = await wallet.balanceUnboundTransaction(
        tx,
        {
          shieldedSecretKeys,
          dustSecretKey,
        } as any,
        { ttl, tokenKindsToBalance: 'all' } as any
      );
      return await wallet.finalizeRecipe(recipe);
    },
  };

  const midnightProvider = {
    submitTx: async (tx: any) => {
      console.log('Submitting contract deployment transaction to Preprod...');
      return await wallet.submitTransaction(tx);
    },
  };

  const providers = {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider,
  };

  const baseContract = CompiledContract.make('TreasuryVault', Contract);
  const compiledContract = CompiledContract.withVacantWitnesses(baseContract);

  const ownerBytes = new Uint8Array(32);
  crypto.randomFillSync(ownerBytes);
  const initialBalance = 1_000_000n;

  console.log('Executing Zero-Knowledge Proving and Deployment via Remote Server...');
  const deployedContract = await deployContract(providers as any, {
    compiledContract: compiledContract as any,
    args: [ownerBytes, initialBalance],
    privateStateKey: 'treasuryVaultPrivateState',
    initialPrivateState: {},
  });

  console.log('\n=============================================');
  console.log('  TreasuryVault DEPLOYED SUCCESSFULLY');
  console.log('=============================================');
  console.log('Contract Address:', deployedContract.deployTxData.public.contractAddress);
  console.log('Transaction Hash:', deployedContract.deployTxData.public.txHash);

  await wallet.stop();
}

main().catch((err) => {
  console.error('\nDeployment failed:', err);
  process.exit(1);
});
