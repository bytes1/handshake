import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, CircleHelp, LockKeyhole, ShieldCheck } from "lucide-react";

const steps = [
  {
    number: "01",
    title: "Connect Lace on Preview",
    body: "Install and unlock Lace, switch it to Midnight Preview, then connect it to Handshake. The browser wallet is used to reserve the offer and approve the final contract transaction.",
  },
  {
    number: "02",
    title: "Review and reserve the offer",
    body: "Choose an amount and review the live limits, exchange quote, and network. Select Review on-chain offer and approve the reservation in Lace. The receipt address is entered in the next screen, after the reservation is made.",
  },
  {
    number: "03",
    title: "Send the demo receipt email",
    body: "In the receipt and submit screen, enter the inbox that should receive the demo email and send it. This email is clearly marked as a demo; it is not a payment confirmation and no external payment is made.",
  },
  {
    number: "04",
    title: "Download the original .eml file",
    body: "Open the message in Gmail. Choose More → Show original → Download original. Keep the downloaded .eml file unchanged. Do not copy its text, forward it, edit it, or save it through another mail client.",
  },
  {
    number: "05",
    title: "Upload, verify, and submit",
    body: "Choose the original .eml file in Handshake and select Verify receipt and submit. The attestor checks the message's Gmail DKIM signature and receipt details. If they pass, review and approve the final transaction in Lace. The contract then releases test tUSDC according to the offer.",
  },
];

export default function UserGuide() {
  return (
    <main className="guide-shell">
      <header className="guide-header">
        <Link className="guide-back" href="/"><ArrowLeft size={16} /> Back to Handshake</Link>
        <span className="guide-network"><i /> MIDNIGHT PREVIEW · DEMO ONLY</span>
      </header>

      <div className="guide-content">
        <section className="guide-hero">
          <div className="guide-eyebrow"><CircleHelp size={14} /> HANDSHAKE USER GUIDE</div>
          <h1>Complete a demo trade</h1>
          <p>Follow these steps to reserve an on-chain offer, verify its Gmail receipt, and submit the proof from your browser wallet.</p>
          <div className="guide-notice"><ShieldCheck size={19} /><span><b>Preview testnet only</b><small>Handshake uses test tokens and a clearly marked demo email. It does not make or confirm a real-world payment.</small></span></div>
        </section>

        <section className="guide-section" id="steps">
          <div className="guide-section-heading"><span>THE TRADE</span><h2>Step by step</h2></div>
          <div className="guide-steps">{steps.map((step) => <article className="guide-step" key={step.number}>
            <span className="guide-step-number">{step.number}</span>
            <div><h3>{step.title}</h3><p>{step.body}</p></div>
          </article>)}</div>
        </section>

        <section className="guide-section">
          <div className="guide-section-heading"><span>WHAT IS CHECKED</span><h2>Receipt verification</h2></div>
          <div className="guide-info-grid">
            <article className="guide-info-card"><LockKeyhole size={18} /><h3>Gmail signature</h3><p>The backend verifies the original message's DKIM signature, including that the passing signature covers the From, To, and Subject headers. Changing the message can break its body hash.</p></article>
            <article className="guide-info-card"><Check size={18} /><h3>Trade-specific details</h3><p>The receipt must match the active reservation, receipt token, intended recipient, amount, currency, and trade reference. A receipt from a different trade will be rejected.</p></article>
            <article className="guide-info-card"><ShieldCheck size={18} /><h3>What DKIM does not prove</h3><p>DKIM confirms that Gmail signed the message and that signed content still verifies. It does not prove that money was transferred or that a person controls the mailbox.</p></article>
          </div>
        </section>

        <section className="guide-section">
          <div className="guide-section-heading"><span>YOUR DATA</span><h2>Privacy and safe use</h2></div>
          <div className="guide-prose">
            <p>When you verify a receipt, the browser sends the complete uploaded .eml file to the configured Handshake attestor. The original message contains its email headers, body, and receipt token. Only upload the demo receipt you intend to use.</p>
            <p>The attestor returns a cryptographic statement for the marketplace contract. The service's signing key and receipt secret stay on the server; never put these values in frontend settings or share them. A passing receipt is evidence for this demo workflow only.</p>
            <p>Your reservation recovery information is saved in this browser profile. To restore, cancel, or complete an unfinished reservation, reconnect the same Lace wallet in the same browser profile. Clearing browser storage can remove the local recovery details.</p>
          </div>
        </section>

        <section className="guide-section">
          <div className="guide-section-heading"><span>COMMON QUESTIONS</span><h2>Troubleshooting</h2></div>
          <div className="guide-faq">
            <details><summary>Can I use the same .eml file twice?</summary><p>You can upload it again to retry verification for the same active reservation if it has not been completed. The receipt is tied to its trade details and cannot be used for a new reservation. Once accepted on-chain, it cannot release the offer a second time.</p></details>
            <details><summary>Why does Gmail DKIM or the body hash fail?</summary><p>Download the original message from Gmail using Show original → Download original. Upload that .eml unchanged. Pasted source, forwarded mail, or a file modified by an editor or mail client may no longer match the signed body.</p></details>
            <details><summary>Why does it say the signed headers are missing?</summary><p>The message needs a passing Gmail DKIM signature whose signed-header list includes From, To, and Subject. Make sure you selected the original Handshake demo receipt, not a forwarded copy.</p></details>
            <details><summary>Why is my receipt rejected as mismatched?</summary><p>Confirm the active reservation is still open and that the email was sent for that reservation to the same recipient shown in the receipt and submit screen. A new reservation needs its own newly sent receipt.</p></details>
            <details><summary>Why can’t the app reach the attestor?</summary><p>The public attestor must be online over HTTPS. Its CORS allowlist must include the exact origin of this frontend, and the frontend must have been rebuilt with the correct NEXT_PUBLIC_ATTESTER_URL.</p></details>
            <details><summary>Can I close the page and continue later?</summary><p>Reconnect the same Lace wallet from the same browser profile and choose Continue reserved trade or Recover reserved trade. If this reservation is no longer wanted, use Cancel reserved intent and approve the transaction in Lace.</p></details>
          </div>
        </section>

        <div className="guide-end"><span>This is a demo on Midnight Preview. No real payment is made.</span><Link href="/">Return to the offer <ArrowRight size={16} /></Link></div>
      </div>
    </main>
  );
}
