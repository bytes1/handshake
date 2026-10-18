import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ARTIFACT = 'file:///C:/Users/abiji/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs';
const { Presentation, PresentationFile } = await import(ARTIFACT);
const ROOT = path.resolve('E:/frontend/Handshake');
const BUILD = path.join(ROOT, '.codex/pitch-build');
const OUT = path.join(ROOT, 'pitch');
const FINAL = path.join(OUT, 'Handshake-Wave-2-Pitch.pptx');
const W = 1280;
const H = 720;
const C = {
  bg: '#0B1016',
  bg2: '#101821',
  white: '#F4F7F8',
  muted: '#B2BEC8',
  dim: '#748390',
  green: '#91E5C2',
  blue: '#8EA8FF',
  line: '#28343D',
  alert: '#F3BD78',
};
const FONT = 'Arial';

function addText(slide, text, x, y, width, height, size, color = C.white, bold = false, opts = {}) {
  const shape = slide.shapes.add({
    geometry: 'textbox',
    name: opts.name,
    position: { left: x, top: y, width, height },
    fill: 'none',
    line: { style: 'solid', fill: 'none', width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    typeface: FONT,
    fontSize: size,
    color,
    bold,
    alignment: opts.align ?? 'left',
    verticalAlignment: opts.valign ?? 'top',
    wrap: 'square',
    autoFit: 'shrinkText',
    lineSpacing: opts.lineSpacing ?? 1.05,
    insets: 0,
  };
  return shape;
}

function rule(slide, x, y, width, color = C.line, height = 2) {
  return slide.shapes.add({
    geometry: 'rect',
    position: { left: x, top: y, width, height },
    fill: color,
    line: { style: 'solid', fill: 'none', width: 0 },
  });
}

function makeSlide(presentation, index, title, eyebrow = 'HANDSHAKE / MIDNIGHT BUILDATHON') {
  const slide = presentation.slides.add({ background: { fill: C.bg } });
  addText(slide, eyebrow.toUpperCase(), 72, 38, 700, 24, 14, C.green, true);
  addText(slide, title, 72, 82, 1110, 76, 44, C.white, true, { lineSpacing: 0.98 });
  rule(slide, 72, 168, 1136, C.line, 1);
  addText(slide, 'HANDSHAKE', 72, 674, 220, 20, 12, C.dim, true);
  addText(slide, `WAVE 2  /  ${String(index).padStart(2, '0')}`, 1030, 674, 178, 20, 12, C.dim, true, { align: 'right' });
  return slide;
}

function notes(slide, extra = '') {
  slide.speakerNotes.text = [
    'Sources: Handshake repository README, app, and Compact marketplace contract as of the Wave 2 snapshot.',
    'Program framing: user-provided Midnight Buildathon brief. Verify submission requirements and dates against the Official Rules and AKINDO.',
    extra,
  ].filter(Boolean).join('\n\n');
}

const deck = Presentation.create({ slideSize: { width: W, height: H } });

// 1. Cover
{
  const slide = deck.slides.add({ background: { fill: { type: 'gradient', gradientKind: 'linear', angleDeg: 0, stops: [ { offset: 0, color: C.bg }, { offset: 100000, color: '#17242C' } ] } } });
  addText(slide, 'MIDNIGHT BUILDATHON  /  WAVE 2', 78, 72, 700, 26, 15, C.green, true);
  addText(slide, 'Handshake', 74, 178, 780, 96, 70, C.white, true);
  addText(slide, 'Payment evidence in.\nEscrowed tokens out.', 78, 300, 690, 156, 45, C.green, true, { lineSpacing: 0.96 });
  addText(slide, 'A Midnight prototype that verifies a signed email receipt off-chain, then lets a buyer settle against seller-funded test tokens on-chain.', 80, 495, 630, 88, 23, C.muted, false, { lineSpacing: 1.15 });
  rule(slide, 80, 621, 145, C.blue, 4);
  addText(slide, 'PREVIEW TESTNET  /  COMPACT CONTRACT  /  LACE', 80, 640, 690, 24, 14, C.dim, true);
  addText(slide, 'H', 865, 178, 280, 300, 250, C.blue, true, { align: 'center', valign: 'middle' });
  addText(slide, 'Selective disclosure\nwith verifiable settlement', 846, 484, 330, 78, 20, C.muted, false, { align: 'center', lineSpacing: 1.15 });
  notes(slide, 'Opening: Handshake connects off-chain payment evidence to on-chain test-token settlement. Be explicit that the receipt is a demo and no fiat payment occurs.');
}

// 2. Problem
{
  const slide = makeSlide(deck, 2, 'A receipt should not become the payment system');
  addText(slide, 'A marketplace needs a reliable way to release an asset after an off-chain payment, while keeping the underlying email out of public contract state.', 74, 202, 1080, 78, 27, C.muted, false, { lineSpacing: 1.18 });
  const columns = [
    { x: 76, n: '01', title: 'Screenshots are weak evidence', body: 'A screenshot can be edited and is hard for a contract to validate.' },
    { x: 472, n: '02', title: 'Receipts contain private data', body: 'Email bodies can reveal names, inboxes, transaction details, and other metadata.' },
    { x: 868, n: '03', title: 'Settlement needs a clear rule', body: 'Both sides need to know when reserved inventory can move and what proof triggers release.' },
  ];
  for (const col of columns) {
    addText(slide, col.n, col.x, 352, 80, 48, 34, C.green, true);
    rule(slide, col.x, 410, 300, C.line, 1);
    addText(slide, col.title, col.x, 432, 300, 58, 23, C.white, true);
    addText(slide, col.body, col.x, 501, 300, 94, 19, C.muted, false, { lineSpacing: 1.17 });
  }
  notes(slide);
}

// 3. Product
{
  const slide = makeSlide(deck, 3, 'Handshake separates evidence from settlement');
  addText(slide, 'OFF-CHAIN', 78, 210, 430, 28, 15, C.blue, true);
  addText(slide, 'The attester checks the original Gmail message.', 78, 260, 490, 76, 31, C.white, true);
  addText(slide, 'It validates Gmail DKIM and the receipt fields against the reserved buyer, amount, recipient, and trade reference.', 78, 360, 470, 112, 21, C.muted, false, { lineSpacing: 1.18 });
  rule(slide, 620, 218, 2, C.line, 350);
  addText(slide, 'ON-CHAIN', 684, 210, 450, 28, 15, C.green, true);
  addText(slide, 'The Compact contract checks the claim.', 684, 260, 500, 76, 31, C.white, true);
  addText(slide, 'A Schnorr signature binds the attestation to the offer and buyer commitment. The contract blocks replay and releases the reserved tUSDC atomically.', 684, 360, 488, 122, 21, C.muted, false, { lineSpacing: 1.18 });
  addText(slide, 'The email file stays off-chain. The buyer submits the resulting proof through Lace.', 78, 555, 1080, 48, 22, C.green, true);
  notes(slide, 'Clarify trust boundary: Gmail DKIM checks and receipt parsing happen in the attester. Midnight verifies the attester signature; it does not verify the email DKIM signature in-circuit.');
}

// 4. Flow
{
  const slide = makeSlide(deck, 4, 'One buyer journey, four contract-aware steps');
  const steps = [
    ['01', 'Fund', 'The maker escrows demo tUSDC into one deployed offer.'],
    ['02', 'Reserve', 'The buyer chooses an amount. The contract locks that liquidity.'],
    ['03', 'Verify', 'The buyer uploads the original email. The attester checks DKIM and signed fields.'],
    ['04', 'Settle', 'Lace submits the attestation. The contract validates and pays the buyer.'],
  ];
  const xs = [76, 366, 656, 946];
  for (let i = 0; i < steps.length; i++) {
    const [num, label, body] = steps[i];
    const x = xs[i];
    addText(slide, num, x, 230, 220, 55, 40, i === 3 ? C.green : C.blue, true);
    rule(slide, x, 302, 236, i === 3 ? C.green : C.line, i === 3 ? 3 : 1);
    addText(slide, label, x, 334, 236, 42, 25, C.white, true);
    addText(slide, body, x, 394, 236, 138, 19, C.muted, false, { lineSpacing: 1.18 });
  }
  addText(slide, 'The prototype demonstrates test-token settlement only. The demo receipt does not represent a fiat payment.', 76, 579, 1085, 42, 18, C.alert, true);
  notes(slide);
}

// 5. Architecture
{
  const slide = makeSlide(deck, 5, 'Midnight anchors the settlement decision');
  const rows = [
    ['BUYER APP', 'Next.js reads the offer from the indexer and prepares intent data.'],
    ['LACE WALLET', 'The buyer reviews and submits reservation, cancellation, and settlement transactions.'],
    ['OFF-CHAIN ATTESTER', 'Gmail DKIM and receipt-field checks produce a Jubjub Schnorr signature.'],
    ['COMPACT CONTRACT', 'Tracks escrow and intents, verifies the signature, prevents replay, and pays test tUSDC.'],
  ];
  let y = 214;
  for (const [label, body] of rows) {
    addText(slide, label, 78, y, 260, 30, 16, C.green, true);
    addText(slide, body, 370, y - 3, 800, 54, 21, C.white, false, { lineSpacing: 1.15 });
    rule(slide, 78, y + 65, 1090, C.line, 1);
    y += 98;
  }
  addText(slide, 'The buyer submits directly; the attester is not a transaction relayer.', 78, 616, 1030, 32, 18, C.muted, false);
  notes(slide, 'Architecture follows the repository: Next.js App Router, Lace connector, public indexer, Compact contract, Gmail demo receipt route, and the off-chain attester service.');
}

// 6. Privacy model
{
  const slide = makeSlide(deck, 6, 'Privacy has a precise boundary in this demo');
  const groups = [
    { x: 76, color: C.green, label: 'KEPT OFF-CHAIN', lines: ['Original email file and body', 'DKIM parsing and sender checks', 'Receipt validation details'] },
    { x: 478, color: C.blue, label: 'PUBLIC ON-CHAIN', lines: ['Recipient address', 'Reservation and offer amounts', 'Offer state and replay keys'] },
    { x: 880, color: C.alert, label: 'TRUSTED TODAY', lines: ['Attester validates the email', 'Demo receipt means no payment', 'Maker secret manages one offer'] },
  ];
  for (const group of groups) {
    addText(slide, group.label, group.x, 230, 320, 32, 15, group.color, true);
    rule(slide, group.x, 278, 320, C.line, 1);
    group.lines.forEach((line, i) => {
      addText(slide, line, group.x, 310 + i * 66, 316, 46, 20, C.white, i === 0, { lineSpacing: 1.1 });
    });
  }
  addText(slide, 'The contract verifies a signed claim, not the email itself. The attester remains part of the trust model.', 76, 568, 1090, 56, 21, C.muted, false, { lineSpacing: 1.16 });
  notes(slide, 'Privacy claims are limited to current implementation. Contract code discloses the recipient, trade amount, and offer state.');
}

// 7. Wave 2 progress
{
  const slide = makeSlide(deck, 7, 'Wave 2 turns the flow into a live testnet demo');
  const items = [
    ['CONCURRENT INTENTS', 'Multiple buyers can reserve against shared offer liquidity; each wallet can hold one active intent per offer.'],
    ['EMAIL ATTESTATION', 'The buyer uploads an unchanged Gmail .eml file; the attester verifies DKIM and trade fields before signing.'],
    ['ON-CHAIN RELEASE', 'The buyer submits the signature from Lace. The Compact contract checks replay keys and pays atomically.'],
    ['RECOVERY PATH', 'The app saves buyer intent data so a pending reservation can be restored or cancelled after a refresh.'],
  ];
  let y = 214;
  for (const [label, body] of items) {
    addText(slide, label, 78, y, 285, 30, 15, C.green, true);
    addText(slide, body, 378, y - 4, 794, 54, 20, C.white, false, { lineSpacing: 1.12 });
    rule(slide, 78, y + 62, 1090, C.line, 1);
    y += 94;
  }
  notes(slide, 'Progress is stated as capability in this Wave 2 code snapshot; it does not claim comparative metrics or user traction.');
}

// 8. Roadmap and viability
{
  const slide = makeSlide(deck, 8, 'The next step is seller-controlled, real payment evidence');
  addText(slide, 'FIRST USE CASE', 78, 222, 300, 25, 15, C.blue, true);
  addText(slide, 'Marketplace settlement where one party pays off-chain and the other releases a digital asset after verified evidence.', 78, 266, 475, 124, 25, C.white, true, { lineSpacing: 1.14 });
  addText(slide, 'ADOPTION PATH', 680, 222, 360, 25, 15, C.green, true);
  addText(slide, 'Start with a marketplace integration and a payment provider that can issue independently verifiable evidence. Keep receipt contents with the authorized verifier.', 680, 266, 480, 150, 21, C.muted, false, { lineSpacing: 1.2 });
  rule(slide, 78, 452, 1090, C.line, 1);
  addText(slide, 'WAVE 3 WORK', 78, 482, 240, 28, 15, C.alert, true);
  addText(slide, 'Seller-created offers and escrow', 78, 529, 315, 66, 20, C.white, true);
  addText(slide, 'Provider-backed payment evidence', 430, 529, 350, 66, 20, C.white, true);
  addText(slide, 'Lower public metadata and broader QA', 822, 529, 340, 66, 20, C.white, true);
  notes(slide, 'Roadmap items are proposed next steps, not shipped features. The current app has one preconfigured maker offer and demo receipts only.');
}

// 9. Close
{
  const slide = deck.slides.add({ background: { fill: C.bg2 } });
  addText(slide, 'MIDNIGHT BUILDATHON  /  WAVE 2', 78, 64, 700, 26, 15, C.green, true);
  addText(slide, 'A receipt becomes\na verifiable claim.', 78, 160, 800, 172, 55, C.white, true, { lineSpacing: 0.98 });
  addText(slide, 'Handshake uses Midnight to bind that claim to a buyer reservation and release escrowed test tokens under a contract rule.', 82, 377, 830, 86, 25, C.muted, false, { lineSpacing: 1.15 });
  rule(slide, 82, 516, 1100, C.line, 1);
  addText(slide, 'SOURCE REPOSITORY', 82, 552, 250, 24, 13, C.dim, true);
  addText(slide, 'github.com/bytes1/handshake', 82, 583, 520, 36, 22, C.green, true);
  addText(slide, 'DEMO SCOPE', 730, 552, 180, 24, 13, C.dim, true);
  addText(slide, 'Midnight Preview · test tUSDC · no fiat payment', 730, 583, 450, 40, 18, C.alert, true);
  addText(slide, 'HANDSHAKE  /  WAVE 2', 82, 674, 300, 20, 12, C.dim, true);
  notes(slide, 'Close by restating the demo boundary. Direct judges to the public repository and live walkthrough.');
}

await fs.mkdir(BUILD, { recursive: true });
await fs.mkdir(OUT, { recursive: true });
for (const [index, slide] of deck.slides.items.entries()) {
  const file = path.join(BUILD, `slide-${String(index + 1).padStart(2, '0')}.png`);
  const blob = await deck.export({ slide, format: 'png', scale: 1 });
  await fs.writeFile(file, new Uint8Array(await blob.arrayBuffer()));
}
const montage = await deck.export({ format: 'webp', montage: true });
await fs.writeFile(path.join(BUILD, 'montage.webp'), new Uint8Array(await montage.arrayBuffer()));

const { finalizePresentation } = await import(pathToFileURL(
  'C:/Users/abiji/.codex/plugins/cache/openai-primary-runtime/presentations/26.1015.12040/skills/Presentations/container_tools/artifact_tool_utils.mjs',
).href);
const candidate = path.join(BUILD, 'candidate.pptx');
await (await PresentationFile.exportPptx(deck)).save(candidate);
const result = await finalizePresentation({
  workspaceDir: ROOT,
  candidatePath: candidate,
  finalPath: FINAL,
  pythonExecutable: 'C:/Users/abiji/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
  integrityValidatorPath: 'C:/Users/abiji/.codex/plugins/cache/openai-primary-runtime/presentations/26.1015.12040/skills/Presentations/container_tools/inspect_presentation_package_integrity.py',
  layoutValidatorPath: 'C:/Users/abiji/.codex/plugins/cache/openai-primary-runtime/presentations/26.1015.12040/skills/Presentations/container_tools/inspect_presentation_layout_geometry.py',
  layoutArgs: ['--expected-slide-size-emu', '12192000,6858000', '--validate-heading-fit'],
  fontPolicy: { basis: 'design', families: [FONT] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(BUILD, 'validation.json'),
});
console.log(JSON.stringify({ finalPath: FINAL, result }, null, 2));
