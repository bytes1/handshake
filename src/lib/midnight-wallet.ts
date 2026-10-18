export type MidnightNetworkId = 'undeployed' | 'preview' | 'preprod';

export type ConnectedMidnightWallet = {
  getUnshieldedAddress(): Promise<{ unshieldedAddress: string }>;
  getUnshieldedBalances?(): Promise<Record<string, unknown>>;
  getShieldedAddresses(): Promise<{ shieldedCoinPublicKey: string; shieldedEncryptionPublicKey: string }>;
  getConnectionStatus(): Promise<{ status: string }>;
  getConfiguration(): Promise<{
    indexerUri: string;
    indexerWsUri: string;
    proverServerUri?: string;
    networkId?: string;
  }>;
  balanceUnsealedTransaction(tx: string): Promise<{ tx: string }>;
  submitTransaction(tx: string): Promise<void>;
};

export type MidnightWalletApi = {
  apiVersion?: string;
  name?: string;
  icon?: string;
  connect(network: MidnightNetworkId): Promise<ConnectedMidnightWallet>;
};

declare global {
  interface Window {
    midnight?: Record<string, MidnightWalletApi>;
  }
}

export function listMidnightWallets(): MidnightWalletApi[] {
  // The DApp supports connector API major version 4. Do not attempt to call an
  // injected wallet API with a version we have not implemented.
  return window.midnight
    ? Object.values(window.midnight).filter((wallet) => /^4\.\d+\.\d+/.test(wallet.apiVersion ?? ''))
    : [];
}
