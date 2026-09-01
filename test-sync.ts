import { WebSocket } from 'ws';
(globalThis as any).WebSocket = WebSocket;

import dotenv from 'dotenv';
import * as Rx from 'rxjs';
import * as bip39 from 'bip39';
import { HDKey } from '@scure/bip32';
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  WalletFacade,
  ShieldedWallet,
  DustWallet,
  UnshieldedWallet,
  createKeystore,
  PublicKey,
  NoOpTransactionHistoryStorage,
} from '@midnight-ntwrk/wallet-sdk';
import {
  LedgerParameters,
  ZswapSecretKeys,
  DustSecretKey,
} from '@midnight-ntwrk/ledger-v8';

dotenv.config();
setNetworkId('preprod');

const CONFIG = {
  indexer: process.env.INDEXER_URL || 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: process.env.INDEXER_WS_URL || 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node: process.env.NODE_URL || 'https://rpc.preprod.midnight.network',
  proofServer: process.env.PROOF_SERVER_URL || 'http://localhost:6300',
};

async function check() {
  const mnemonic = (process.env.WALLET_SEED || '').trim();
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const master = HDKey.fromMasterSeed(seed);

  const unshieldedNode = master.derive("m/44'/2400'/0'/0/0");
  const shieldedNode = master.derive("m/44'/2400'/0'/2/0");

  const shieldedSecretKeys = ZswapSecretKeys.fromSeed(shieldedNode.privateKey!);
  const dustSecretKey = DustSecretKey.fromSeed(unshieldedNode.privateKey!);
  const unshieldedKeystore = createKeystore(unshieldedNode.privateKey!, getNetworkId());

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
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
  };

  const initialDustParams = LedgerParameters.initialParameters().dust;

  console.log(`Starting sync probe for ${unshieldedKeystore.getBech32Address()}...`);
  const wallet = await WalletFacade.init({
    configuration: { ...shieldedConfig, ...unshieldedConfig, ...dustConfig },
    shielded: (cfg: any) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg: any) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg: any) => DustWallet(cfg).startWithSecretKey(dustSecretKey, initialDustParams),
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);

  wallet.state().subscribe((state: any) => {
    console.log('\n--- State Update ---');
    console.log('Sync Status:', state.syncStatus);
    console.log('Unshielded Balances:', state.unshielded?.balances);
    console.log('DUST Balance:', state.dust?.availableBalance ?? state.dust);
  });
}

check().catch(console.error);
