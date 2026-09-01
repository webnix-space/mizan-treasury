import { WebSocket } from 'ws';
(globalThis as any).WebSocket = WebSocket;

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

dotenv.config();
setNetworkId('preprod');

// FORCING LOCAL PROVER
const CONFIG = {
  indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preprod.midnight.network',
  proofServer: 'http://localhost:6300', 
};

function derive1AMKeys(mnemonic: string) {
  const seed = bip39.mnemonicToSeedSync(mnemonic.trim());
  const master = HDKey.fromMasterSeed(seed);
  return {
    unshieldedPrivateKey: master.derive("m/44'/2400'/0'/0/0").privateKey!,
    shieldedPrivateKey: master.derive("m/44'/2400'/0'/2/0").privateKey!,
    dustPrivateKey: master.derive("m/44'/2400'/0'/0/0").privateKey!,
  };
}

async function main() {
  console.log('Booting EC2 Brute-Force DUST Minter...');
  if (!process.env.WALLET_SEED) throw new Error('WALLET_SEED missing');

  const keys = derive1AMKeys(process.env.WALLET_SEED);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys.shieldedPrivateKey);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys.dustPrivateKey);
  const unshieldedKeystore = createKeystore(keys.unshieldedPrivateKey, getNetworkId());

  const baseConfig = {
    networkId: getNetworkId(),
    indexerClientConnection: { indexerHttpUrl: CONFIG.indexer, indexerWsUrl: CONFIG.indexerWS },
  };

  const wallet = await WalletFacade.init({
    configuration: {
      ...baseConfig,
      provingServerUrl: new URL(CONFIG.proofServer),
      relayURL: new URL(CONFIG.node.replace(/^http/, 'ws')),
      txHistoryStorage: new NoOpTransactionHistoryStorage(),
      costParameters: { additionalFeeOverhead: 0n, feeBlocksMargin: 5 },
    },
    shielded: (cfg: any) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg: any) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg: any) => DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });

  await wallet.start(shieldedSecretKeys, dustSecretKey);
  console.log('Wallet synchronized. Internal fibers engaged.');
  console.log('Monitoring DUST state. The SDK will auto-mint using your local proof server if deficit is detected.\n');

  wallet.state().subscribe((state: any) => {
    const unshieldedBalance = Object.values(state.unshielded?.balances || {}).reduce((a: any, b: any) => a + BigInt(b), 0n);
    const dustBalance = state.dust?.totalCoins || 0n;
    
    console.log(`[STATE] Unshielded tNIGHT: ${unshieldedBalance} | Ready DUST: ${dustBalance}`);
    
    if (dustBalance > 100_000n) {
      console.log('\n[SUCCESS] DUST target reached. Proceed to deployment.');
      process.exit(0);
    }
  });

  setInterval(() => {}, 10000);
}

main().catch(console.error);
