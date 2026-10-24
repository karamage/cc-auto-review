/** node:crypto のうち、サーバが使う createHash("sha256") だけを txiki.js の tjs:hashing で書いたもの */
import { createHash as tjsCreateHash } from "tjs:hashing";

interface Hash {
  update(data: string): Hash;
  digest(encoding: "hex"): string;
}

export function createHash(algorithm: "sha256"): Hash {
  const inner = tjsCreateHash(algorithm);
  const hash: Hash = {
    update(data) {
      inner.update(data);
      return hash;
    },
    // tjs:hashing の digest は 16 進しか返さないので、encoding は "hex" に限る
    digest: () => inner.digest(),
  };
  return hash;
}
