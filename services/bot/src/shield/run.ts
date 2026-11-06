/** shield:run CLI: live mode is disabled (owner review required). */
async function main(): Promise<void> {
  console.error("shield:run live is disabled: owner review required");
  process.exit(2);
}

await main();
