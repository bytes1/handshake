"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Coins,
  FileCheck2,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Wallet,
} from "lucide-react";

type WelcomeScreenProps = {
  onEnter: () => void;
};

export function WelcomeScreen({ onEnter }: WelcomeScreenProps) {
  const [leaving, setLeaving] = useState(false);

  const enterMarketplace = () => {
    if (leaving) return;
    setLeaving(true);
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 620;
    window.setTimeout(onEnter, delay);
  };

  return (
    <main className={`welcome-screen${leaving ? " welcome-screen-leaving" : ""}`}>
      <div className="welcome-backdrop" aria-hidden="true">
        <span className="welcome-grid" />
        <span className="welcome-glow welcome-glow-one" />
        <span className="welcome-glow welcome-glow-two" />
        <span className="welcome-star welcome-star-one">✳</span>
        <span className="welcome-star welcome-star-two">✳</span>
      </div>

      <header className="welcome-header">
        <a className="welcome-brand" href="#welcome" aria-label="Handshake home">
          <span className="welcome-brand-mark"><ArrowLeftRight size={18} strokeWidth={2.5} /></span>
          <span>handshake<span>.</span></span>
        </a>
        <div className="welcome-header-right">
          <span className="welcome-network"><i /> MIDNIGHT PREVIEW NETWORK</span>
          <Link className="welcome-skip welcome-guide-link" href="/guide">User guide <ArrowUpRight size={14} /></Link>
          <button className="welcome-skip" onClick={enterMarketplace}>Skip intro <ArrowRight size={14} /></button>
        </div>
      </header>

      <section className="welcome-hero" id="welcome">
        <div className="welcome-copy">
          <div className="welcome-eyebrow"><span className="welcome-eyebrow-line" /> A NEW KIND OF SETTLEMENT</div>
          <h1>Proof in.<br /><span>Settlement out.</span></h1>
          <p className="welcome-description">A verified receipt becomes an on-chain settlement.</p>
          <p className="welcome-subdescription">Explore a new way to exchange value: private email verification, transparent offer terms, and settlement powered by Midnight.</p>

          <div className="welcome-actions">
            <button className="welcome-primary" onClick={enterMarketplace}>
              Explore app <ArrowRight size={17} />
            </button>
            <a className="welcome-secondary" href="#welcome-steps">How it works <ArrowDown size={15} /></a>
          </div>

          <div className="welcome-reassurance">
            <span><LockKeyhole size={14} /> Email stays off-chain</span>
            <i />
            <span><ShieldCheck size={15} /> Midnight Preview</span>
          </div>
          <div className="welcome-network-note"><span /> MIDNIGHT PREVIEW <i /> Testnet experience</div>
        </div>

        <div className="welcome-art settlement-stage" role="img" aria-label="Animated settlement flow: reserve with Lace, receive a Gmail receipt, verify its original file off-chain, then release test tokens through a Midnight Compact contract">
          <div className="stage-aura" />
          <div className="stage-grid" />
          <div className="stage-orbit stage-orbit-one" />
          <div className="stage-orbit stage-orbit-two" />
          <div className="stage-orbit stage-orbit-three" />
          <div className="stage-route" aria-hidden="true"><i /><i /><i /><i /></div>

          <div className="stage-node stage-reserve">
            <span className="stage-icon stage-icon-violet"><Wallet size={17} /></span>
            <span><small>01 · RESERVE</small><b>Approve in Lace</b><em>Buyer intent on Midnight</em></span>
            <span className="stage-node-check"><BadgeCheck size={13} /></span>
          </div>
          <div className="stage-node stage-email">
            <span className="stage-icon stage-icon-coral"><Mail size={17} /></span>
            <span><small>02 · RECEIPT</small><b>Receipt arrives</b><em>Gmail · original message</em></span>
            <span className="stage-node-check"><BadgeCheck size={13} /></span>
          </div>
          <div className="stage-node stage-verify">
            <span className="stage-icon stage-icon-blue"><FileCheck2 size={17} /></span>
            <span><small>03 · VERIFY</small><b>Original .eml checked</b><em>DKIM verification off-chain</em></span>
            <span className="stage-node-check"><BadgeCheck size={13} /></span>
          </div>
          <div className="stage-node stage-release">
            <span className="stage-icon stage-icon-lime"><Coins size={17} /></span>
            <span><small>04 · SETTLE</small><b>Test tokens released</b><em>Compact contract on Midnight</em></span>
            <span className="stage-node-check"><BadgeCheck size={13} /></span>
          </div>

          <div className="stage-core">
            <div className="stage-core-top"><span className="stage-live-dot" /> MIDNIGHT <span>PREVIEW</span></div>
            <div className="stage-coin-wrap"><div className="stage-coin"><span>H</span><small>TEST</small></div><span className="stage-coin-shadow" /></div>
            <b>Escrow <ArrowRight size={14} /> release</b>
            <small>One atomic settlement</small>
            <div className="stage-core-bottom"><ShieldCheck size={12} /> Proof checked by contract</div>
          </div>
          <div className="stage-caption"><span className="stage-caption-line" /> FROM RECEIPT TO SETTLEMENT <span className="stage-caption-line" /></div>
        </div>
      </section>

      <section className="welcome-steps" id="welcome-steps">
        <div className="welcome-steps-heading"><span>THE WAVE 2 FLOW</span><p>One receipt. A clear verification path.</p></div>
        <div className="welcome-step"><span className="welcome-step-number">01</span><div><b>Reserve</b><small>Lace locks a test-token amount.</small></div><ArrowUpRight size={16} /></div>
        <div className="welcome-step"><span className="welcome-step-number">02</span><div><b>Send & verify</b><small>Gmail receipt, original .eml.</small></div><ArrowUpRight size={16} /></div>
        <div className="welcome-step"><span className="welcome-step-number">03</span><div><b>Settle on-chain</b><small>Compact checks proof, releases tUSDC.</small></div><ArrowUpRight size={16} /></div>
      </section>

      <footer className="welcome-footer"><span><span className="welcome-footer-spark">✳</span> A more human way to exchange.</span><button onClick={enterMarketplace}>Explore app <ArrowRight size={14} /></button><small>EARLY TESTNET EXPERIENCE</small></footer>
    </main>
  );
}
