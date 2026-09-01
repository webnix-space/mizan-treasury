import dotenv from 'dotenv';
import * as bip39 from 'bip39';
import { HDKey } from '@scure/bip32';
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { createKeystore, HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk';

dotenv.config();
setNetworkId('preprod');

const TARGET_ADDRESS = 'mn_addr_preprod1fchskm4kq7txs0nkk5dhaw65w4lcfyp5hp7mvex052w96kspcpfsdtwpq4';
const mnemonic = (process.env.WALLET_SEED || '').trim();

if (!mnemonic) {
  console.error('WALLET_SEED missing in .env');
  process.exit(1);
}

const seed = bip39.mnemonicToSeedSync(mnemonic);
const master = HDKey.fromMasterSeed(seed);

const paths = [
  "m/1852'/2400'/0'",
  "m/1852'/2400'/0'/0/0",
  "m/44'/2400'/0'",
  "m/44'/2400'/0'/0/0",
  "m/1852'/1815'/0'",
  "m/44'/1815'/0'",
  "m/44'/0'/0'",
  "m/0'/0'/0'"
];

console.log(`Target Address: ${TARGET_ADDRESS}\n`);
console.log('Testing derivation paths:');

let found = false;
for (const path of paths) {
  try {
    const derived = master.derive(path);
    const privKey = derived.privateKey;
    if (!privKey) continue;

    const keystore = createKeystore(privKey, getNetworkId());
    const addr = keystore.getBech32Address();
    console.log(`Path: ${path.padEnd(20)} => ${addr}`);

    if (addr === TARGET_ADDRESS) {
      console.log(`\n MATCH FOUND: ${path}`);
      found = true;
      break;
    }
  } catch (err) {}
}

if (!found) {
  // Test raw SDK HDWallet accounts 0 to 5
  console.log('\nTesting raw SDK HDWallet account indices...');
  const entropy = Buffer.from(bip39.mnemonicToEntropy(mnemonic), 'hex');
  const hd = HDWallet.fromSeed(entropy);
  if (hd.type === 'seedOk') {
    for (let acc = 0; acc < 5; acc++) {
      const res = hd.hdWallet.selectAccount(acc).selectRoles([Roles.NightExternal]).deriveKeysAt(0);
      if (res.type === 'keysDerived') {
        const ks = createKeystore(res.keys[Roles.NightExternal], getNetworkId());
        const a = ks.getBech32Address();
        console.log(`HDWallet Account ${acc} => ${a}`);
        if (a === TARGET_ADDRESS) {
          console.log(`\n MATCH FOUND: HDWallet Account ${acc}`);
          found = true;
          break;
        }
      }
    }
  }
}
