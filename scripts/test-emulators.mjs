import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = ['emulators:exec', '--project', 'demo-sulmi', '--only', 'auth,firestore', '--config', 'firebase.json', 'node --test --test-concurrency=1 tests/firebase/integration.mjs'];
const cli = process.env.FIREBASE_CLI_PATH || resolve(root, 'node_modules/firebase-tools/lib/bin/firebase.js');
const installed = existsSync(cli);
const command = installed ? process.execPath : process.platform === 'win32' ? 'npx.cmd' : 'npx';
const commandArgs = installed ? [cli, ...args] : ['--yes', 'firebase-tools@13.35.1', ...args];
console.log('Pruebas aisladas: demo-sulmi · Auth 9099 · Firestore 8080. Requiere Java 17 o superior.');
const child = spawn(command, commandArgs, {
  cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && !installed,
  env: { ...process.env, CI: 'true' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
