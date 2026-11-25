#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const compose = ['compose', '-p', 'navin-chain-quickstart', '-f', 'docker-compose.quickstart.yml'];

function run(args, options = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    stdio: options.quiet ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(' ')} failed (${result.status})`);
  }
  return result.stdout?.trim();
}

try {
  run([...compose, 'up', '-d', '--wait']);

  const wasm = process.env.NAVIN_CONTRACTS_WASM;
  if (!wasm) {
    throw new Error(
      'NAVIN_CONTRACTS_WASM is required (path to navin-contracts target/wasm32v1-none/release/navin_escrow.wasm)'
    );
  }

  run(['cp', wasm, 'navin-chain-quickstart-quickstart-1:/tmp/navin-escrow.wasm']);

  const secret =
    run(
      ['exec', '-T', 'navin-chain-quickstart-quickstart-1', 'stellar', 'keys', 'show', 'default'],
      { quiet: true }
    ) || '';
  if (!secret) throw new Error('Quickstart default signer is unavailable');

  const wasmHash = run(
    [
      'exec',
      '-T',
      'navin-chain-quickstart-quickstart-1',
      'stellar',
      'contract',
      'install',
      '--wasm',
      '/tmp/navin-escrow.wasm',
      '--rpc-url',
      'http://localhost:8000/soroban/rpc',
      '--network-passphrase',
      'Standalone Network ; February 2017',
      '--source',
      'default',
    ],
    { quiet: true }
  );

  if (!wasmHash) throw new Error('Contract WASM install returned no wasm hash');

  const contractId = run(
    [
      'exec',
      '-T',
      'navin-chain-quickstart-quickstart-1',
      'stellar',
      'contract',
      'deploy',
      '--wasm-hash',
      wasmHash,
      '--rpc-url',
      'http://localhost:8000/soroban/rpc',
      '--network-passphrase',
      'Standalone Network ; February 2017',
      '--source',
      'default',
    ],
    { quiet: true }
  );

  if (!contractId?.startsWith('C')) throw new Error('Contract deployment returned no contract ID');
  console.log(`PASS: deployed navin-escrow contract ${contractId}`);
  console.log('PASS: quickstart RPC and contract deployment smoke check');
} finally {
  run([...compose, 'down', '-v', '--remove-orphans'], { quiet: true });
}
