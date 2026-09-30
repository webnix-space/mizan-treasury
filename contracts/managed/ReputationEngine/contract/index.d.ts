import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  workerSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  initialize(context: __compactRuntime.CircuitContext<PS>,
             initialRoot_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  verifyCredential(context: __compactRuntime.CircuitContext<PS>,
                   nullifierHash_0: Uint8Array,
                   minScoreThreshold_0: bigint,
                   claimedScore_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  updateAttestationRoot(context: __compactRuntime.CircuitContext<PS>,
                        newRoot_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  initialize(context: __compactRuntime.CircuitContext<PS>,
             initialRoot_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  verifyCredential(context: __compactRuntime.CircuitContext<PS>,
                   nullifierHash_0: Uint8Array,
                   minScoreThreshold_0: bigint,
                   claimedScore_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  updateAttestationRoot(context: __compactRuntime.CircuitContext<PS>,
                        newRoot_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  initialize(context: __compactRuntime.CircuitContext<PS>,
             initialRoot_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  verifyCredential(context: __compactRuntime.CircuitContext<PS>,
                   nullifierHash_0: Uint8Array,
                   minScoreThreshold_0: bigint,
                   claimedScore_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  updateAttestationRoot(context: __compactRuntime.CircuitContext<PS>,
                        newRoot_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly attestationRoot: Uint8Array;
  readonly isInitialized: boolean;
  readonly totalCredentialsVerified: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
