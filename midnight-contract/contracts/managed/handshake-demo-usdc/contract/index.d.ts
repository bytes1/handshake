import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  mintDemo(context: __compactRuntime.CircuitContext<PS>,
           minterSecret_0: Uint8Array,
           recipient_0: { bytes: Uint8Array },
           amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  mintDemo(context: __compactRuntime.CircuitContext<PS>,
           minterSecret_0: Uint8Array,
           recipient_0: { bytes: Uint8Array },
           amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  mintDemo(context: __compactRuntime.CircuitContext<PS>,
           minterSecret_0: Uint8Array,
           recipient_0: { bytes: Uint8Array },
           amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly minterCommitment: Uint8Array;
  readonly domain: Uint8Array;
  readonly maximumSupply: bigint;
  readonly totalMinted: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               minterSecret_0: Uint8Array,
               tokenDomain_0: Uint8Array,
               supplyCap_0: bigint): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
