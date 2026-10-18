"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownUp,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Compass,
  CreditCard,
  Globe2,
  History,
  LockKeyhole,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import { listMidnightWallets, type ConnectedMidnightWallet, type MidnightWalletApi } from "@/lib/midnight-wallet";
import { attestAndSubmitDemoPayment, cancelMarketIntent, clearSavedActiveIntent, formatTokenAmount, isReservedIntentBuyer, loadActiveIntent, MARKET_ADDRESS, NETWORK_ID, NETWORK_LABEL, paymentMinorFromDollars, quoteTokenAmount, readBuyerDemoTokenBalance, readMarket, reserveMarketIntent, updateSavedActiveIntent, type MarketSnapshot, type ZkStage } from "@/lib/midnight-market";
import { WelcomeScreen } from "@/components/welcome-screen";

type Offer = {
  name: string;
  initials: string;
  color: string;
  rail: string;
  rate: number;
  available: number;
  limit: string;
  time: string;
  score: string;
};

const demoOffer: Offer = { name: "Handshake maker", initials: "H", color: "mint", rail: "Gmail", rate: 1.006, available: 0, limit: "Loading on-chain limits", time: "Preview testnet", score: "On-chain" };

const railMarks: Record<string, string> = { Zelle: "Z", Venmo: "v", PayPal: "P", CashApp: "$", Gmail: "G" };
const zkProgressSteps = ["DKIM Verified", "Building ZK Proof", "Lace Approval", "Token Settlement"];

function RailMark({ name, large = false }: { name: string; large?: boolean }) {
  return <span className={`rail-mark rail-${name.toLowerCase()}${large ? " rail-mark-large" : ""}`}>{railMarks[name] ?? name[0]}</span>;
}

function formatError(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      messages.push(current.message || current.name);
      current = current.cause;
    } else if (typeof current === "string") {
      messages.push(current);
      break;
    } else {
      try { messages.push(JSON.stringify(current)); } catch { messages.push(String(current)); }
      break;
    }
  }
  return messages.filter(Boolean).join(" — Caused by: ") || "An unexpected error occurred.";
}

export default function Home() {
  const [hasEnteredMarketplace, setHasEnteredMarketplace] = useState(false);
  const [mode, setMode] = useState<"Buy" | "Sell">("Buy");
  const [amount, setAmount] = useState("500");
  const [paymentEmail, setPaymentEmail] = useState("");
  const [showWallet, setShowWallet] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletApi, setWalletApi] = useState<ConnectedMidnightWallet | null>(null);
  const [walletOptions, setWalletOptions] = useState<MidnightWalletApi[]>([]);
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [marketSnapshot, setMarketSnapshot] = useState<MarketSnapshot | null>(null);
  const [marketError, setMarketError] = useState("");
  const [buyerTokenBalance, setBuyerTokenBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const [marketBusy, setMarketBusy] = useState(false);
  const [zkStage, setZkStage] = useState<ZkStage | null>(null);
  const [zkElapsedSeconds, setZkElapsedSeconds] = useState(0);
  const zkProofStartedAt = useRef<number | null>(null);
  const [activeIntent, setActiveIntent] = useState<ReturnType<typeof loadActiveIntent>>(null);
  const [receiptEmailBase64, setReceiptEmailBase64] = useState("");
  const [receiptFileName, setReceiptFileName] = useState("");
  const [receiptFileBusy, setReceiptFileBusy] = useState(false);
  const [marketTxId, setMarketTxId] = useState("");
  const [showTrade, setShowTrade] = useState(false);
  const [toast, setToast] = useState("");
  const currentOffer = marketSnapshot ? {
    ...demoOffer,
    rate: Number(marketSnapshot.exchangeRateBps) / 10000,
    available: Number(marketSnapshot.availableLiquidity) / 1_000_000,
    limit: `$${(Number(marketSnapshot.minimumFill) / (Number(marketSnapshot.exchangeRateBps) * 100)).toFixed(2)} – $${(Number(marketSnapshot.maximumFill) / (Number(marketSnapshot.exchangeRateBps) * 100)).toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
  } : demoOffer;
  const quantity = useMemo(() => {
    const value = Number(amount) || 0;
    return mode === "Buy" ? value * currentOffer.rate : value / currentOffer.rate;
  }, [amount, currentOffer.rate, mode]);
  const displayPaymentAmount = activeIntent
    ? Number(BigInt(activeIntent.paymentMinor)) / 100
    : marketSnapshot?.buyerIntentActive
      ? Number(BigInt(marketSnapshot.intentPaymentMinor)) / 100
      : Number(amount || 0);
  const displayTokenAmount = activeIntent
    ? Number(BigInt(activeIntent.amount)) / 1_000_000
    : marketSnapshot?.buyerIntentActive
      ? Number(BigInt(marketSnapshot.intentAmount)) / 1_000_000
      : quantity;
  const isConnectedBuyerOfReservedIntent = Boolean(
    walletAddress && marketSnapshot && isReservedIntentBuyer(marketSnapshot, walletAddress),
  );
  const zkCurrentStep = zkStage === "validating_email" ? 0
    : zkStage === "generating_witness" || zkStage === "synthesizing_proof" ? 1
      : zkStage === "submitting_to_lace" ? 2
        : zkStage === "confirmed" ? 3 : -1;
  const zkStageMessage = zkStage === "validating_email" ? "Checking the reservation and verifying the original email."
    : zkStage === "generating_witness" ? `Preparing the transaction witness${zkElapsedSeconds ? ` (${zkElapsedSeconds}s)` : "…"}`
      : zkStage === "synthesizing_proof" ? `The proof server is building the ZK proof (${zkElapsedSeconds}s). This can take 10–25 seconds.`
        : zkStage === "submitting_to_lace" ? "Review and approve the transaction in your Lace wallet."
          : zkStage === "confirmed" ? "The transaction is confirmed and the contract released test tUSDC."
            : "";

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  };

  useEffect(() => {
    setActiveIntent(null);
    setMarketTxId("");
  }, []);

  useEffect(() => {
    if ((zkStage !== "generating_witness" && zkStage !== "synthesizing_proof") || zkProofStartedAt.current === null) return;
    const updateElapsed = () => setZkElapsedSeconds(Math.floor((Date.now() - (zkProofStartedAt.current ?? Date.now())) / 1000));
    updateElapsed();
    const intervalId = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(intervalId);
  }, [zkStage]);

  useEffect(() => {
    if (!walletApi) {
      setMarketSnapshot(null);
      setBuyerTokenBalance(null);
      setBalanceLoading(false);
      setBalanceError("");
      return;
    }
    let cancelled = false;
    setMarketError("");
    void readMarket(walletApi).then((snapshot) => {
      if (cancelled) return;
      setMarketSnapshot(snapshot);
      const savedIntent = loadActiveIntent(walletAddress);
      const savedIntentMatchesBuyer = savedIntent &&
        (!savedIntent.buyerAddress || savedIntent.buyerAddress === walletAddress) &&
        savedIntent.amount === snapshot.intentAmount &&
        (!savedIntent.intentNonce || savedIntent.intentNonce === snapshot.intentNonce);
      if (snapshot.buyerIntentActive && isReservedIntentBuyer(snapshot, walletAddress) && savedIntentMatchesBuyer) {
        setActiveIntent(savedIntent);
        setPaymentEmail(savedIntent.recipientEmail);
        setMarketTxId(savedIntent.reservationTxId ?? "");
      } else {
        setActiveIntent(null);
        if (!snapshot.buyerIntentActive) setMarketTxId("");
      }
    }).catch((error: unknown) => {
      if (!cancelled) setMarketError(error instanceof Error ? error.message : "Unable to read the deployed offer.");
    });
    setBalanceLoading(true);
    setBalanceError("");
    void readBuyerDemoTokenBalance(walletApi).then((balance) => {
      if (!cancelled) setBuyerTokenBalance(balance);
    }).catch((error: unknown) => {
      if (!cancelled) setBalanceError(error instanceof Error ? error.message : "Unable to read the tUSDC balance.");
    }).finally(() => {
      if (!cancelled) setBalanceLoading(false);
    });
    return () => { cancelled = true; };
  }, [walletApi, walletAddress]);

  const connectMidnightWallet = async (wallet: MidnightWalletApi) => {
    setWalletBusy(true);
    setWalletError("");
    try {
      const api = await wallet.connect(NETWORK_ID);
      const [address, connection] = await Promise.all([api.getUnshieldedAddress(), api.getConnectionStatus()]);
      if (connection.status !== "connected") throw new Error("Wallet did not establish a connection.");
      const config = await api.getConfiguration();
      if (config.networkId && config.networkId !== NETWORK_ID) throw new Error(`Lace connected to ${config.networkId}; select ${NETWORK_LABEL} in Lace.`);
      setWalletAddress(address.unshieldedAddress);
      setActiveIntent(null);
      setMarketTxId("");
      setMarketSnapshot(null);
      setWalletApi(api);
      setShowWallet(false);
      notify(`Connected to Midnight ${NETWORK_LABEL}.`);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Unable to connect to this Midnight wallet.");
    } finally {
      setWalletBusy(false);
    }
  };

  const openWalletPicker = () => {
    setWalletError("");
    setWalletOptions(listMidnightWallets());
    setShowWallet(true);
  };

  const disconnectMidnightWallet = () => {
    setWalletApi(null);
    setWalletAddress("");
    setActiveIntent(null);
    setMarketSnapshot(null);
    notify("Wallet disconnected from this app.");
  };

  const refreshMarket = async () => {
    if (!walletApi) return;
    setMarketBusy(true);
    setBalanceLoading(true);
    const [marketResult, balanceResult] = await Promise.allSettled([
      readMarket(walletApi, walletAddress),
      readBuyerDemoTokenBalance(walletApi),
    ]);
    if (marketResult.status === "fulfilled") {
      setMarketSnapshot(marketResult.value);
      setMarketError("");
    } else {
      setMarketError(`Marketplace refresh failed: ${formatError(marketResult.reason)}`);
    }
    if (balanceResult.status === "fulfilled") {
      setBuyerTokenBalance(balanceResult.value);
      setBalanceError("");
    } else {
      setBalanceError(formatError(balanceResult.reason));
    }
    setBalanceLoading(false);
    setMarketBusy(false);
  };

  const reserveTrade = async () => {
    if (!walletApi || !walletAddress) { setShowTrade(false); openWalletPicker(); return; }
    setMarketBusy(true);
    setMarketError("");
    setMarketTxId("");
    try {
      const result = await reserveMarketIntent(walletApi, amount, walletAddress);
      setActiveIntent(result.intent);
      setMarketTxId(result.txId);
      await refreshMarket();
    } catch (error) {
      setMarketError(formatError(error));
    } finally { setMarketBusy(false); }
  };

  const selectReceiptFile = async (file?: File) => {
    setReceiptEmailBase64("");
    setReceiptFileName("");
    setMarketError("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".eml")) {
      setMarketError("Choose the .eml file downloaded from Gmail Show original.");
      return;
    }
    if (!file.size || file.size > 2 * 1024 * 1024) {
      setMarketError("The .eml file must be no larger than 2 MiB.");
      return;
    }
    setReceiptFileBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      }
      setReceiptEmailBase64(window.btoa(binary));
      setReceiptFileName(file.name);
    } catch (error) {
      setMarketError(`Unable to read the .eml file: ${formatError(error)}`);
    } finally {
      setReceiptFileBusy(false);
    }
  };

  const submitDemoProof = async (rawEmailBase64 = "") => {
    if (!activeIntent) return;
    if (!walletApi) { setShowTrade(false); openWalletPicker(); return; }
    setMarketBusy(true);
    setMarketError("");
    setZkStage("validating_email");
    setZkElapsedSeconds(0);
    zkProofStartedAt.current = null;
    try {
      const result = await attestAndSubmitDemoPayment(walletApi, activeIntent, rawEmailBase64, (stage) => {
        if (stage === "generating_witness" && zkProofStartedAt.current === null) zkProofStartedAt.current = Date.now();
        if (stage === "confirmed" && zkProofStartedAt.current !== null) {
          setZkElapsedSeconds(Math.floor((Date.now() - zkProofStartedAt.current) / 1000));
          zkProofStartedAt.current = null;
        }
        setZkStage(stage);
      });
      setActiveIntent(null);
      setReceiptEmailBase64("");
      setReceiptFileName("");
      setMarketTxId(result.txId);
      notify("Proof accepted. Testnet tUSDC released to your Lace wallet.");
      await refreshMarket();
    } catch (error) {
      setZkStage(null);
      zkProofStartedAt.current = null;
      setMarketError(formatError(error));
    } finally { setMarketBusy(false); }
  };

  const closeTradeDialog = () => {
    if (marketBusy) return;
    setShowTrade(false);
    setZkStage(null);
    zkProofStartedAt.current = null;
  };

  const sendDemoReceipt = async () => {
    if (!activeIntent) return;
    const recipient = paymentEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setMarketError("Enter a valid email address for the receipt.");
      return;
    }
    setMarketBusy(true);
    setMarketError("");
    try {
      const intent = updateSavedActiveIntent(activeIntent, { recipientEmail: recipient, receiptToken: undefined, resendEmailId: undefined });
      setActiveIntent(intent);
      const response = await fetch("/api/demo-receipts/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: recipient, tradeReference: intent.tradeReference, amountMinor: intent.paymentMinor, buyerAddress: intent.buyerAddress }),
      });
      const result = await response.json() as { receiptToken?: string; resendEmailId?: string; sentTo?: string; error?: string };
      if (!response.ok || !result.receiptToken) throw new Error(result.error ?? `Receipt email failed (HTTP ${response.status}).`);
      const updated = updateSavedActiveIntent(intent, { receiptToken: result.receiptToken, resendEmailId: result.resendEmailId });
      setActiveIntent(updated);
      notify(`Receipt sent to ${result.sentTo}. No external payment was made.`);
    } catch (error) {
      setMarketError(`Gmail receipt send failed: ${formatError(error)}`);
    } finally { setMarketBusy(false); }
  };

  const changeReceiptEmail = (value: string) => {
    setPaymentEmail(value);
    setReceiptEmailBase64("");
    setReceiptFileName("");
    if (activeIntent && value.trim().toLowerCase() !== activeIntent.recipientEmail) {
      const updated = updateSavedActiveIntent(activeIntent, {
        recipientEmail: value.trim().toLowerCase(),
        receiptToken: undefined,
        resendEmailId: undefined,
      });
      setActiveIntent(updated);
    }
  };

  const cancelTrade = async () => {
    if (!activeIntent) return;
    if (!walletApi) { setShowTrade(false); openWalletPicker(); return; }
    setMarketBusy(true);
    setMarketError("");
    try {
      const txId = await cancelMarketIntent(walletApi, activeIntent);
      setActiveIntent(null);
      setMarketTxId(txId);
      await refreshMarket();
    } catch (error) {
      setMarketError(formatError(error));
    } finally { setMarketBusy(false); }
  };

  const discardStaleIntent = () => {
    clearSavedActiveIntent(walletAddress);
    setActiveIntent(null);
    setMarketError("");
    setMarketTxId("");
    void refreshMarket();
    notify("Cleared the stale local intent. You can reserve this offer again.");
  };

  const restoreSavedIntent = () => {
    if (!walletAddress || !marketSnapshot || !isReservedIntentBuyer(marketSnapshot, walletAddress)) {
      setMarketError("This reservation belongs to another buyer. You can’t restore or cancel their intent.");
      return;
    }
    const intent = loadActiveIntent(walletAddress);
    if (!intent || (intent.buyerAddress && intent.buyerAddress !== walletAddress) ||
      intent.amount !== marketSnapshot.intentAmount || (intent.intentNonce && intent.intentNonce !== marketSnapshot.intentNonce)) {
      setMarketError("No saved buyer intent was found for this site address. Reopen the original tab or browser profile used when you reserved.");
      return;
    }
    setActiveIntent(intent);
    setPaymentEmail(intent.recipientEmail);
    setMarketTxId(intent.reservationTxId ?? "");
    setMarketError("");
  };

  if (!hasEnteredMarketplace) {
    return <WelcomeScreen onEnter={() => setHasEnteredMarketplace(true)} />;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="Handshake home">
          <span className="brand-symbol"><ArrowLeftRight size={19} strokeWidth={2.4} /></span>
          <span>handshake<span className="brand-period">.</span></span>
        </a>

        <div className="sidebar-section-label">Workspace</div>
        <nav className="main-nav" aria-label="Main navigation">
          <button className="nav-item active" onClick={() => notify("You’re already on the marketplace.")}><ArrowDownUp size={18} /> Trade <span className="nav-active-dot" /></button>
          <button className="nav-item" onClick={() => notify("Activity will appear here once you trade.")}><History size={18} /> Activity</button>
          <button className="nav-item" onClick={() => notify("Explore is coming soon.")}><Compass size={18} /> Explore</button>
        </nav>

        <div className="sidebar-bottom">
          <div className="network-card">
            <span className="network-orb"><span /></span>
            <span className="network-copy"><b>Midnight network</b><small>{NETWORK_LABEL}</small></span>
            <span className="network-status" />
          </div>
          <Link className="nav-item support-link" href="/guide"><CircleHelp size={18} /> Help center</Link>
          <button className="profile-row" onClick={walletAddress ? disconnectMidnightWallet : openWalletPicker}>
            <span className="profile-avatar">{walletAddress ? walletAddress.slice(0, 1).toUpperCase() : "G"}</span><span className="profile-copy"><b>{walletAddress ? `${walletAddress.slice(0, 7)}…${walletAddress.slice(-5)}` : "Guest account"}</b><small>{walletAddress ? `Midnight ${NETWORK_LABEL} · Disconnect` : "Connect a wallet"}</small></span><MoreHorizontal size={18} />
          </button>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><b>Trade</b></div>
          <div className="topbar-actions"><span className="market-open"><i /> Midnight {NETWORK_LABEL}</span><button className="icon-button notification-button" aria-label="Refresh market" onClick={() => void refreshMarket()}><History size={18} /></button><button className="connect-button" onClick={walletAddress ? disconnectMidnightWallet : openWalletPicker}><Wallet size={16} /> {walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : "Connect Lace"}</button></div>
        </header>

        <div className="content-wrap">
          <div className="page-heading">
            <div><div className="eyebrow"><span className="eyebrow-star">✳</span> PEER TO PEER, MADE SIMPLE</div><h1>Move money <span>your way.</span></h1><p>Compare an offer, verify your receipt, and settle transparently on Midnight.</p></div>
            <Link className="how-button" href="/guide#steps"><Sparkles size={15} /> How it works <ArrowUpRight size={14} /></Link>
          </div>

          <div className="trade-layout">
            <section className="trade-card">
              <div className="trade-card-top"><div className="segmented-control"><button className={mode === "Buy" ? "selected" : ""} onClick={() => setMode("Buy")}>Buy</button><button disabled title="The current Sandbox flow supports buyers only" className={mode === "Sell" ? "selected" : ""} onClick={() => setMode("Sell")}>Sell</button></div><button className="icon-button subtle" aria-label="Trade settings" onClick={() => notify("More trade settings are coming soon.")}><MoreHorizontal size={20} /></button></div>

              <div className="amount-label">{mode === "Buy" ? "You pay" : "You send"}</div>
              <div className="amount-panel"><div className="amount-input-wrap"><span className="currency-symbol">$</span><input aria-label="Amount in US dollars" value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))} /><span className="amount-currency">USD</span></div><div className="amount-bottom"><span>Available offers for your amount</span><div className="quick-amounts"><button onClick={() => setAmount("100")}>$100</button><button onClick={() => setAmount("500")}>$500</button><button onClick={() => setAmount("1000")}>$1k</button></div></div></div>

              <div className="swap-connector"><span><ArrowDownUp size={15} /></span></div>
              <div className="amount-label">{mode === "Buy" ? "You receive" : "You get"}</div>
              <div className="receive-panel"><div className="receive-token"><span className="token-icon">H</span><span><b>Handshake test tUSDC</b><small>Testnet token · 6 decimals</small></span><ChevronDown size={16} /></div><div className="receive-amount"><b>{displayTokenAmount.toLocaleString("en-US", { maximumFractionDigits: 6 })}</b><span>Test token · no real USDC value</span></div><div className="wallet-token-balance"><span>Connected wallet balance</span><b>{balanceLoading ? "Loading…" : buyerTokenBalance === null ? walletAddress ? "Unavailable" : "Connect Lace" : `${buyerTokenBalance} tUSDC`}</b>{balanceError && <small title={balanceError}>Balance unavailable · reconnect or refresh</small>}</div></div>

              <div className="detail-row network-detail"><div className="detail-label"><span>Network</span><small>Deployed marketplace contract</small></div><button className="network-selector" onClick={() => notify(`Select ${NETWORK_LABEL} in Lace to connect to this marketplace.`)}><span className="network-mini"><span /></span> {NETWORK_LABEL} <ChevronDown size={15} /></button></div>

              <div className="quote-box"><span><LockKeyhole size={14} /> Contract: {MARKET_ADDRESS.slice(0, 8)}…</span><span className="quote-separator" /><span>On-chain rate <b>1 USD = {currentOffer.rate.toFixed(3)} tUSDC</b></span></div>
              <button className="continue-button" disabled={mode !== "Buy" || marketBusy} onClick={() => setShowTrade(true)}>{activeIntent ? "Continue reserved trade" : isConnectedBuyerOfReservedIntent ? "Recover reserved trade" : mode === "Buy" ? "Review on-chain offer" : "Sell unavailable"}<ArrowRight size={17} /></button>
              <div className="secure-note"><ShieldCheck size={13} /> Reserve with Lace, verify the original .eml, then submit attested proof</div>
            </section>

            <section className="offers-column">
              <div className="offers-heading"><div><div className="offers-eyebrow"><span className="live-pulse" /> {marketSnapshot ? "CONNECTED TO CONTRACT" : `${NETWORK_ID.toUpperCase()} MARKET`}</div><h2>Deployed offer <span className="offer-count">{marketSnapshot ? "01" : "—"}</span></h2></div><button className="filter-button" disabled={!walletApi || marketBusy} onClick={() => void refreshMarket()}><History size={14} /> {marketBusy ? "Syncing" : "Refresh"}</button></div>
              <div className="offers-caption">{walletAddress ? `Offer state read from the Midnight ${NETWORK_LABEL} indexer` : `Connect Lace on ${NETWORK_LABEL} to load this offer`} <span>·</span> tUSDC <button onClick={() => void refreshMarket()}><Globe2 size={12} /> {NETWORK_LABEL}</button></div>

              <div className="offer-list">{[currentOffer].map((offer) => {
                const paymentMinor = (() => { try { return paymentMinorFromDollars(amount); } catch { return 0n; } })();
                const output = marketSnapshot ? quoteTokenAmount(paymentMinor, BigInt(marketSnapshot.exchangeRateBps)) : 0n;
                const min = BigInt(marketSnapshot?.minimumFill ?? "0");
                const max = BigInt(marketSnapshot?.maximumFill ?? "0");
                const disabled = !marketSnapshot || !walletAddress || output < min || output > max || output > BigInt(marketSnapshot.availableLiquidity) || marketSnapshot.buyerIntentActive;
                return <button key={offer.name} className={`offer-card offer-selected${disabled ? " offer-disabled" : ""}`} onClick={() => { if (!disabled) setShowTrade(true); }}>
                  <div className="offer-person"><span className={`person-avatar ${offer.color}`}>{offer.initials}<i><BadgeCheck size={11} fill="currentColor" /></i></span><span className="person-name"><b>{offer.name}<BadgeCheck size={13} fill="currentColor" /></b><small><span className="star">✦</span> Live offer terms · verified by contract state</small></span><span className="offer-more"><MoreHorizontal size={18} /></span></div>
                  <div className="offer-data-grid"><span>Exchange rate <b>{offer.rate.toFixed(3)} <small>tUSDC / USD</small></b></span><span>Available <b>{marketSnapshot ? `${formatTokenAmount(marketSnapshot.availableLiquidity)} tUSDC` : "Connect Lace"}</b></span><span>Settlement <b><Clock3 size={12} /> Midnight Preview</b></span></div>
                  <div className="offer-card-footer"><span className="offer-limit">USD limits {offer.limit}</span><span className="offer-pay"><RailMark name="Gmail" /> Gmail-signed email proof <span className="offer-divider">·</span> {displayTokenAmount.toLocaleString("en-US", { maximumFractionDigits: 6 })} tUSDC</span></div>
                  {marketSnapshot && marketSnapshot.activeIntentCount !== "0" && <div className="offer-unavailable">{isConnectedBuyerOfReservedIntent ? activeIntent ? "Your buyer intent is reserved. Continue it from the trade panel." : "Your wallet has a reservation. Recover it from the trade panel." : `${marketSnapshot.activeIntentCount} other buyer reservation${marketSnapshot.activeIntentCount === "1" ? "" : "s"} active. Remaining inventory is still available.`}</div>}
                  {marketSnapshot && disabled && marketSnapshot.buyerIntentActive !== true && <div className="offer-unavailable">Connect Lace or enter an amount within the live offer limits.</div>}
                </button>;
              })}</div>
              {marketError && <p role="alert" className="checkout-error">{marketError}</p>}
              {marketTxId && <p className="chain-tx-note">Latest wallet transaction: {marketTxId}</p>}
              <div className="trust-panel"><div className="trust-icon"><ShieldCheck size={18} /></div><div><b>Contract backed tUSDC escrow</b><p>The buyer reserves inventory, then uploads the original Gmail message for DKIM verification. No external payment is made.</p><button onClick={() => notify(`Market address: ${MARKET_ADDRESS}`)}>View market address <ArrowUpRight size={12} /></button></div><div className="trust-watermark">✳</div></div>
            </section>
          </div>

          <footer className="page-footer"><span>Built for people, powered by <b>Midnight</b> <span className="footer-spark">✳</span></span><div><button onClick={() => notify("Terms will be available at launch.")}>Terms</button><button onClick={() => notify("Privacy policy will be available at launch.")}>Privacy</button><button onClick={() => notify("Status: all systems operational.")}>Status <i /></button></div></footer>
        </div>
      </section>

      {toast && <div role="status" className="toast"><Check size={15} />{toast}</div>}
      {showWallet && <div className="modal-backdrop" onClick={() => setShowWallet(false)}><section className="dialog wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-title" onClick={(event) => event.stopPropagation()}><button className="dialog-close" onClick={() => setShowWallet(false)} aria-label="Close"><X size={18} /></button><div className="dialog-icon"><Wallet size={21} /></div><div className="dialog-kicker">YOUR WALLET, YOUR KEYS</div><h2 id="wallet-title">Connect a Midnight wallet</h2><p>Connect Lace to Midnight {NETWORK_LABEL}. Select <b>Preview</b> in Lace. The app uses the Preview node and indexer, plus your local proof server at <b>127.0.0.1:6300</b>.</p>{walletOptions.length ? walletOptions.map((wallet, index) => <button key={`${wallet.name ?? "wallet"}-${index}`} className="wallet-option" disabled={walletBusy} onClick={() => void connectMidnightWallet(wallet)}><span className="wallet-option-icon"><Plus size={19} /></span><span><b>{wallet.name ?? `Midnight wallet ${index + 1}`}</b><small>{wallet.apiVersion ? `Connector API ${wallet.apiVersion} · ${NETWORK_LABEL}` : NETWORK_LABEL}</small></span><ArrowRight size={16} /></button>) : <div className="wallet-empty">No Midnight wallet detected. Install and unlock Lace, then refresh this page.</div>}{walletError && <p role="alert" className="checkout-error">{walletError}</p>}<div className="dialog-footnote"><LockKeyhole size={12} /> This app never receives your recovery phrase or private keys.</div></section></div>}
      {showTrade && <div className="modal-backdrop" onClick={closeTradeDialog}><section className="dialog trade-dialog" role="dialog" aria-modal="true" aria-labelledby="trade-title" onClick={(event) => event.stopPropagation()}>
        <button className="dialog-close" onClick={closeTradeDialog} aria-label="Close" disabled={marketBusy}><X size={18} /></button>
        <div className="dialog-icon"><Banknote size={21} /></div>
        <div className="dialog-kicker">{activeIntent ? "BUYER INTENT RESERVED" : `${NETWORK_LABEL.toUpperCase()} TRADE`}</div>
        <h2 id="trade-title">{activeIntent ? "Payment proof" : isConnectedBuyerOfReservedIntent ? "Recover reserved trade" : "Reserve this offer"}</h2>
        <p>{activeIntent ? "Send a receipt, then upload its original .eml file for Gmail DKIM verification. No external payment is made." : isConnectedBuyerOfReservedIntent ? "This reservation belongs to your connected wallet. Restore its saved buyer intent to continue." : marketSnapshot && marketSnapshot.activeIntentCount !== "0" ? `${marketSnapshot.activeIntentCount} buyer reservation${marketSnapshot.activeIntentCount === "1" ? " is" : "s are"} active. You can reserve too while inventory remains available.` : "Review the exact offer quote. Lace will ask you to approve the Midnight reservation transaction before the receipt is sent."}</p>
        <div className="review-summary"><span>You pay<b>${displayPaymentAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</b></span><ArrowDownUp size={16} /><span>Contract quote<b>{displayTokenAmount.toLocaleString("en-US", { maximumFractionDigits: 6 })} tUSDC</b></span></div>
        <div className="review-peer"><span className={`person-avatar ${currentOffer.color}`}>{currentOffer.initials}</span><span><small>Offer & network</small><b>{currentOffer.name} · Lace / {NETWORK_LABEL}</b><small>Gmail DKIM · .eml verification</small></span><span className="review-verified"><BadgeCheck size={14} /> Testnet</span></div>
        {activeIntent && <div className="intent-reference"><span>Trade reference</span><b>{activeIntent.tradeReference}</b><span>Buyer recovery data is saved for this wallet in this browser.</span></div>}
        {(marketError || walletError) && <p role="alert" className="checkout-error">{marketError || walletError}</p>}
        {marketTxId && <p className="chain-tx-note">Transaction submitted: {marketTxId}</p>}
        {zkStage && <div className="zk-progress" role="region" aria-label="Payment proof progress" aria-busy={zkStage !== "confirmed"}>
          <div className="zk-progress-status">
            <span className={`zk-progress-status-icon${zkStage === "confirmed" ? " is-complete" : ""}`}>
              {zkStage === "confirmed" ? <Check size={14} /> : <span className="zk-progress-spinner" />}
            </span>
            <span><b>{zkStage === "confirmed" ? "Settlement complete" : "Verifying and settling"}</b><small>{zkStageMessage}</small></span>
          </div>
          <ol className="zk-progress-steps">
            {zkProgressSteps.map((step, index) => {
              const complete = zkStage === "confirmed" || zkCurrentStep > index;
              const current = zkStage !== "confirmed" && zkCurrentStep === index;
              return <li key={step} className={complete ? "is-complete" : current ? "is-active" : ""} aria-current={current ? "step" : undefined}>
                <span className="zk-progress-step-marker">{complete ? <Check size={12} /> : current ? <span className="zk-progress-spinner" /> : index + 1}</span>
                <span>{step}</span>
              </li>;
            })}
          </ol>
        </div>}
        {activeIntent ? <>
          <label className="receipt-email-row"><span>Receipt inbox<small>Send the email here, then download its original .eml file</small></span><input type="email" value={paymentEmail} onChange={(event) => changeReceiptEmail(event.target.value)} aria-label="Receipt destination email" /></label>
          <button className="secondary-action" disabled={marketBusy} onClick={() => void sendDemoReceipt()}>{marketBusy ? "Sending receipt…" : activeIntent.receiptToken ? "Send another receipt" : "Send receipt"}</button>
          {activeIntent.receiptToken && <div className="intent-reference"><span>Receipt sent</span><b>{activeIntent.recipientEmail}</b><span>In Gmail, choose “Show original” → “Download original”, then select the .eml file below.</span></div>}
          <label className="receipt-email-row receipt-source-row"><span>Original email file<small>Upload the unchanged .eml file downloaded from Gmail “Show original”.</small></span><input type="file" accept=".eml,message/rfc822" aria-label="Upload original receipt EML file" disabled={receiptFileBusy || marketBusy} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void selectReceiptFile(file); }} /></label>
          {receiptFileName && <div className="intent-reference"><span>Original email selected</span><b>{receiptFileName}</b><span>The file will be checked without changing its original bytes.</span></div>}
          <button className="continue-button dialog-action" disabled={marketBusy || receiptFileBusy || !receiptEmailBase64 || !activeIntent.receiptToken || !activeIntent.recipientEmail} onClick={() => void submitDemoProof(receiptEmailBase64)}>{marketBusy ? "Processing payment proof…" : receiptFileBusy ? "Reading .eml file…" : "Verify receipt and submit"}<ArrowRight size={16} /></button>
          <button className="secondary-action" disabled={marketBusy} onClick={() => void cancelTrade()}>Cancel reserved intent</button>
          {marketError.includes("This saved intent is stale:") && <button className="secondary-action" disabled={marketBusy} onClick={discardStaleIntent}>Discard stale local intent</button>}
          <div className="secure-note"><ShieldCheck size={13} /> No payment was made. The backend verifies Gmail DKIM and the signed receipt claims.</div>
        </> : isConnectedBuyerOfReservedIntent ? <>
          <button className="secondary-action" disabled={marketBusy} onClick={restoreSavedIntent}>Restore saved intent</button>
          <div className="secure-note"><ShieldCheck size={13} /> Without the saved buyer secret, the contract reservation cannot be proved or cancelled.</div>
        </> : <>
          <button className="continue-button dialog-action" disabled={marketBusy || !walletAddress || !marketSnapshot} onClick={() => void reserveTrade()}>{marketBusy ? "Waiting for Lace…" : walletAddress ? "Reserve with Lace" : "Connect Lace to continue"}<ArrowRight size={16} /></button>
          <div className="secure-note"><CreditCard size={13} /> No external payment is made in this flow.</div>
        </>}
      </section></div>}
    </main>
  );
}
