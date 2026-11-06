import { screenOutgoing, classifyIncoming } from "./index.js";

const samples = [
  "We accept your offer.",
  "Approved. Please proceed with the purchase.",
  "I can't accept that on Bridgett's behalf.",
  "Bridgett will review the offer.",
];

for (const sample of samples) {
  const result = screenOutgoing(sample);
  console.log(
    `${result.allowed ? "ALLOWED" : "BLOCKED"}  ${JSON.stringify(sample)}${result.reason ? ` (${result.reason})` : ""}`,
  );
}

console.log(`incoming "Here is our offer": ${classifyIncoming("Here is our offer").kind}`);
