/**
 * Runnable demonstration of approval-gated payments in DEMO_MODE.
 *
 * Run with: pnpm --filter @second-seat/core demo:payments
 * (or, from this package: `npm run demo:payments` after a build.)
 *
 * DEMO_MODE simulates the PayPal sandbox end to end: no network, no
 * credentials, and every record and log entry is stamped mode "demo"
 * with DEMO-ORDER ids and demo.invalid URLs, so the output can never be
 * mistaken for real sandbox activity. The state machine and approval log
 * are the production ones; only the PayPal port is simulated. For the
 * real sandbox, the web app wires `createPayPalSandboxPort` (see
 * apps/web/src/paypalSandbox.ts) behind the same gate.
 */
import { createDemoPayPalPort, createPaymentGate } from "./payments/index.js";

// Two payment commitments as extracted from a meeting record. In the
// product these come from the evidence brief; here they are literals so
// the demo is self-contained.
const commitments = [
  {
    meetingId: "meeting-2026-11-06-standup",
    amount: "1250.00",
    currency: "USD",
    payee: "Apex Venue Rentals",
    purpose: "Deposit for the December showcase venue",
    sourceSegmentId: "t-12:40",
  },
  {
    meetingId: "meeting-2026-11-06-standup",
    amount: "480.00",
    currency: "USD",
    payee: "Studio North",
    purpose: "Mastering session for the demo recording",
    sourceSegmentId: "t-18:05",
  },
];

const gate = createPaymentGate({ port: createDemoPayPalPort() });

console.log("MODE: DEMO (simulated PayPal sandbox responses; no network, no credentials)");
console.log("");

const first = await gate.propose(commitments[0]!, "second-seat");
const second = await gate.propose(commitments[1]!, "second-seat");
for (const record of [first, second]) {
  console.log(
    `PROPOSED ${record.id}  ${record.amount} ${record.currency} -> ${record.payee}  [${record.status}]  order=${record.paypalOrderId}`,
  );
}

const approved = await gate.approve(first.id, "owner");
console.log(
  `APPROVED ${approved.id}  [${approved.status}]  checkout=${approved.checkoutUrl}`,
);

const rejected = await gate.reject(second.id, "owner", "Price not agreed in the meeting");
console.log(`REJECTED ${rejected.id}  [${rejected.status}]  note=${rejected.decisionNote}`);

console.log("");
console.log("Approval log (append-only, mode-stamped):");
for (const entry of gate.approvalLog()) {
  console.log(JSON.stringify(entry));
}
