// SignerRef compatible with @orangecheck/agent-signer that defers BIP-322
// signing to whatever wallet the operator has on hand (UniSat, Xverse,
// Sparrow, bitcoind's `signmessagewithprivkey`, an HSM…). The canonical
// message that must be signed is printed to stderr; the operator pastes
// the resulting base64 signature back on stdin.
//
// The agent's private key NEVER appears in this process.

import { createInterface } from 'node:readline/promises';
import { stdin, stderr } from 'node:process';

export interface InteractiveSigner {
    address: string;
    signMessage: (msg: string) => Promise<string>;
}

export function makeInteractiveSigner(address: string): InteractiveSigner {
    return {
        address,
        signMessage: async (msg: string) => {
            stderr.write('\n');
            stderr.write('─'.repeat(72) + '\n');
            stderr.write(`SIGN THIS MESSAGE with the BIP-322 wallet for ${address}:\n`);
            stderr.write('─'.repeat(72) + '\n');
            stderr.write(msg + '\n');
            stderr.write('─'.repeat(72) + '\n');
            stderr.write('paste the base64 BIP-322 signature and press <enter>:\n> ');

            const rl = createInterface({ input: stdin });
            const sig = (await rl.question('')).trim();
            rl.close();

            if (!sig) throw new Error('no signature provided — aborting');
            return sig;
        },
    };
}
