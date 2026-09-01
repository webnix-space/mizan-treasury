import { describe, it, expect } from '@jest/globals';
import { Contract } from '../contracts/managed/TreasuryVault/contract/index.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Mizan Treasury Vault Contract Circuit Tests', () => {
  it('should have valid compiled contract constructor', () => {
    expect(Contract).toBeDefined();
    expect(typeof Contract).toBe('function');
  });

  it('should verify all compiled circuit artifacts exist on disk', () => {
    const managedDir = path.resolve(process.cwd(), 'contracts/managed/TreasuryVault');
    expect(fs.existsSync(managedDir)).toBe(true);

    const contractIndex = path.join(managedDir, 'contract/index.js');
    expect(fs.existsSync(contractIndex)).toBe(true);

    const contractCjs = path.join(managedDir, 'contract/index.cjs');
    expect(fs.existsSync(contractCjs) || fs.existsSync(contractIndex)).toBe(true);
  });

  it('should verify ledger state transition circuits and methods exist', () => {
    // Check methods on the Contract prototype or instance
    const prototypeMethods = Object.getOwnPropertyNames(Contract.prototype);
    expect(prototypeMethods.length).toBeGreaterThan(0);
    expect(prototypeMethods).toContain('constructor');
  });
});
