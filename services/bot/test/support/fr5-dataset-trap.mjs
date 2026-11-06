import fs from "node:fs";

const orig = fs.readFileSync;
fs.readFileSync = function guardedRead(path, ...rest) {
  const name = String(path);
  if (/dev-40-55|spark-dev|holdout-v1|\/heldout\/|heldout-presealed|shield-heldout/.test(name)) {
    throw new Error(`dataset read ${name}`);
  }
  return orig.call(this, path, ...rest);
};
