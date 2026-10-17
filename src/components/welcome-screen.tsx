"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CircleDollarSign,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UserRound,
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
          <span className="welcome-network"><i /> MIDNIGHT TESTNET PREVIEW</span>
          <Link className="welcome-skip welcome-guide-link" href="/guide">User guide <ArrowUpRight size={14} /></Link>
          <button className="welcome-skip" onClick={enterMarketplace}>Skip intro <ArrowRight size={14} /></button>
        </div>
      </header>

      <section className="welcome-hero" id="welcome">
        <div className="welcome-copy">
          <div className="welcome-eyebrow"><span className="welcome-eyebrow-line" /> THE PEER-TO-PEER MARKETPLACE</div>
          <h1>Good trades<br />start with <span>trust.</span></h1>
          <p className="welcome-description">Meet directly. Pay your way. Move at your own pace.</p>
          <p className="welcome-subdescription">Handshake brings peer-to-peer trading and privacy-first technology into one clear experience.</p>

          <div className="welcome-actions">
            <button className="welcome-primary" onClick={enterMarketplace}>
              Explore the marketplace <ArrowRight size={17} />
            </button>
            <a className="welcome-secondary" href="#welcome-steps">How it works <ArrowDown size={15} /></a>
          </div>

          <div className="welcome-reassurance">
            <span><LockKeyhole size={14} /> Your details stay yours</span>
            <i />
            <span><ShieldCheck size={15} /> Built on Midnight</span>
          </div>
        </div>

        <div className="welcome-art" role="img" aria-label="Illustration of two people exchanging value with private verification">
          <div className="welcome-art-orbit welcome-art-orbit-outer" />
          <div className="welcome-art-orbit welcome-art-orbit-inner" />
          <div className="welcome-art-ring-label ring-label-top"><span /> PEER NETWORK</div>
          <div className="welcome-art-ring-label ring-label-bottom"><span /> PRIVATE BY DESIGN</div>

          <div className="welcome-person-card welcome-person-left">
            <span className="welcome-person-avatar avatar-violet"><UserRound size={18} /></span>
            <span className="welcome-person-copy"><b>One person</b><small>your payment app</small></span>
            <span className="welcome-person-signal"><i /></span>
          </div>

          <div className="welcome-exchange-core">
            <div className="welcome-core-halo" />
            <span className="welcome-core-symbol"><ArrowLeftRight size={29} strokeWidth={1.8} /></span>
            <span className="welcome-core-caption">PEER TO PEER</span>
          </div>

          <div className="welcome-person-card welcome-person-right">
            <span className="welcome-person-avatar avatar-lime"><CircleDollarSign size={19} /></span>
            <span className="welcome-person-copy"><b>Another person</b><small>their digital asset</small></span>
            <span className="welcome-person-signal"><i /></span>
          </div>

          <div className="welcome-proof-card">
            <div className="welcome-proof-top"><span className="welcome-proof-icon"><ShieldCheck size={16} /></span><span><b>Private verification</b><small>Proof without oversharing</small></span><BadgeCheck className="welcome-proof-check" size={17} /></div>
            <div className="welcome-proof-meter"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><span>ENCRYPTED</span></div>
            <div className="welcome-proof-footer"><span><span className="welcome-proof-dot" /> Ready when you are</span><Sparkles size={14} /></div>
          </div>

          <span className="welcome-float-chip float-chip-one"><span className="float-chip-icon"><LockKeyhole size={13} /></span> Keep the details private</span>
          <span className="welcome-float-chip float-chip-two"><span className="float-chip-dot" /> People-powered exchange</span>
          <span className="welcome-art-decoration art-dot-one" />
          <span className="welcome-art-decoration art-dot-two" />
          <span className="welcome-art-decoration art-star">✳</span>
        </div>
      </section>

      <section className="welcome-steps" id="welcome-steps">
        <div className="welcome-steps-heading"><span>THE SIMPLE VERSION</span><p>From first hello to final confirmation.</p></div>
        <div className="welcome-step"><span className="welcome-step-number">01</span><div><b>Find your match</b><small>Choose an offer that fits.</small></div><ArrowUpRight size={16} /></div>
        <div className="welcome-step"><span className="welcome-step-number">02</span><div><b>Pay your way</b><small>Use a payment method you know.</small></div><ArrowUpRight size={16} /></div>
        <div className="welcome-step"><span className="welcome-step-number">03</span><div><b>Move forward</b><small>Follow each step with clarity.</small></div><ArrowUpRight size={16} /></div>
      </section>

      <footer className="welcome-footer"><span><span className="welcome-footer-spark">✳</span> A more human way to exchange.</span><button onClick={enterMarketplace}>Enter Handshake <ArrowRight size={14} /></button><small>EARLY TESTNET EXPERIENCE</small></footer>
    </main>
  );
}
