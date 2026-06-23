# Agent wallets (local only)

JSON files here are **gitignored**. Each file is a 64-byte secret key array (Stellar `Keypair` format).

Create keypairs before running `scripts/setup-usdc-mock.js` / agents:

```bash
# Example: new keypair written to alpha.json (repeat for beta, judge, escrow, x402-provider as needed)
node -e "const fs=require('fs');const {Keypair}=require('@stellar/stellar-sdk');const k=Keypair.generate();fs.writeFileSync('alpha.json',JSON.stringify(Array.from(k.secretKey)));console.log(k.publicKey.toBase58());"
```

Or use [Stellar CLI](https://docs.stellar.com/cli/install-stellar-cli-tools): `stellar-keygen new -o alpha.json`

`poster.json` may be created automatically by `setup-usdc-mock.js` if your Stellar CLI default wallet is unavailable.
