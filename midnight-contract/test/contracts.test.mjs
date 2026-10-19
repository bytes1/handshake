import assert from 'node:assert/strict';
import test from 'node:test';
import * as Runtime from '@midnight-ntwrk/compact-runtime';
import { Contract as MarketContract, ledger as marketLedger, pureCircuits as marketPureCircuits } from '../contracts/managed/handshake-market/contract/index.js';
import { Contract as DemoTokenContract, ledger as demoTokenLedger } from '../contracts/managed/handshake-demo-usdc/contract/index.js';

const bytes = (value) => new Uint8Array(32).fill(value);
const address = () => ({ bytes: Uint8Array.from(Buffer.from(Runtime.sampleUserAddress(), 'hex')) });

function createMarket(args = {}) {
  const contract = new MarketContract({});
  const constructorArgs = {
    makerSecret: bytes(1),
    liquidityCapacity: 1_000n,
    minFill: 10n,
    maxFill: 1_000n,
    rateBps: 2n,
    attesterPublicKey: { x: 1n, y: 2n },
    tokenDomain: bytes(2),
    tokenContract: { bytes: bytes(3) },
    expiresAt: 9_999_999_999_999n,
    ...args,
  };
  const state = contract.initialState(
    Runtime.createConstructorContext({}, Runtime.sampleSigningKey()),
    constructorArgs.makerSecret,
    constructorArgs.liquidityCapacity,
    constructorArgs.minFill,
    constructorArgs.maxFill,
    constructorArgs.rateBps,
    constructorArgs.attesterPublicKey,
    constructorArgs.tokenDomain,
    constructorArgs.tokenContract,
    constructorArgs.expiresAt,
  );
  return { contract, state };
}

function createDemoToken(supplyCap = 100n, minterSecret = bytes(7)) {
  const contract = new DemoTokenContract({});
  const state = contract.initialState(
    Runtime.createConstructorContext({}, Runtime.sampleSigningKey()),
    minterSecret,
    bytes(8),
    supplyCap,
  );
  return { contract, state, minterSecret };
}

function execute(contract, state, circuit, ...args) {
  const context = Runtime.createCircuitContext(
    Runtime.dummyContractAddress(),
    Runtime.sampleSigningKey(),
    state.currentContractState,
    {},
  );
  return contract.impureCircuits[circuit](context, ...args);
}

test('demo token initializes with an empty supply and configured cap', () => {
  const { state } = createDemoToken(500n);
  const ledger = demoTokenLedger(state.currentContractState.data);

  assert.equal(ledger.totalMinted, 0n);
  assert.equal(ledger.maximumSupply, 500n);
});

test('demo token constructor rejects a zero supply cap', () => {
  assert.throws(() => createDemoToken(0n), /Supply cap must be positive/);
});

test('demo token minter can mint a positive amount within the cap', () => {
  const { contract, state, minterSecret } = createDemoToken(100n);
  const result = execute(contract, state, 'mintDemo', minterSecret, address(), 40n);

  assert.equal(demoTokenLedger(result.context.currentQueryContext.state).totalMinted, 40n);
});

test('demo token rejects minting by another secret', () => {
  const { contract, state } = createDemoToken(100n);

  assert.throws(
    () => execute(contract, state, 'mintDemo', bytes(9), address(), 1n),
    /Only the demo token minter can mint/,
  );
});

test('demo token rejects zero amounts and amounts above the supply cap', () => {
  const { contract, state, minterSecret } = createDemoToken(100n);

  assert.throws(() => execute(contract, state, 'mintDemo', minterSecret, address(), 0n), /Mint amount must be positive/);
  assert.throws(() => execute(contract, state, 'mintDemo', minterSecret, address(), 101n), /Demo token supply cap exceeded/);
});

test('market initializes with liquidity unavailable until maker funding', () => {
  const { state } = createMarket();
  const ledger = marketLedger(state.currentContractState.data);

  assert.equal(ledger.initialLiquidity, 1_000n);
  assert.equal(ledger.availableLiquidity, 0n);
  assert.equal(ledger.escrowedBalance, 0n);
  assert.equal(ledger.activeIntentCount, 0n);
  assert.equal(ledger.tradeState, 0n);
});

test('market constructor rejects invalid capacity, fill bounds, rate, and expiry', () => {
  assert.throws(() => createMarket({ liquidityCapacity: 0n }), /Liquidity capacity must be positive/);
  assert.throws(() => createMarket({ minFill: 0n }), /Minimum fill must be positive/);
  assert.throws(() => createMarket({ minFill: 20n, maxFill: 10n }), /Minimum fill exceeds maximum fill/);
  assert.throws(() => createMarket({ maxFill: 1_001n }), /Maximum fill exceeds liquidity capacity/);
  assert.throws(() => createMarket({ rateBps: 0n }), /Exchange rate must be positive/);
  assert.throws(() => createMarket({ expiresAt: 0n }), /Offer expiry must be set/);
  assert.throws(() => createMarket({ attesterPublicKey: { x: 0n, y: 1n } }), /Attester public key cannot be the identity point/);
});

test('market will not reserve an intent before token inventory is funded', () => {
  const { contract, state } = createMarket();
  const takerSecret = bytes(4);

  assert.throws(
    () => execute(contract, state, 'reserveIntent', takerSecret, 10n, 5n, address()),
    /Insufficient available liquidity/,
  );
});

test('payment attestation transcript is deterministic and binds receipt and nullifier', () => {
  const base = [bytes(1), bytes(2), 3n, 4n, 1n, bytes(5), bytes(6)];
  const first = marketPureCircuits.paymentAttestationMessage(...base);
  const same = marketPureCircuits.paymentAttestationMessage(...base);
  const otherReceipt = marketPureCircuits.paymentAttestationMessage(...base.slice(0, 5), bytes(7), base[6]);
  const otherNullifier = marketPureCircuits.paymentAttestationMessage(...base.slice(0, 6), bytes(8));

  assert.deepEqual(first, same);
  assert.notDeepEqual(first, otherReceipt);
  assert.notDeepEqual(first, otherNullifier);
});
