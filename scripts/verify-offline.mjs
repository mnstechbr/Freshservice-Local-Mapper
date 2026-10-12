// Evidência local de reinicialização: exige banco sintético criado pelo E2E 04, nunca banco do usuário.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { chromium } from '@playwright/test';

const root = realpathSync('.e2e-data');
const supplied = process.argv[2];
assert(supplied, 'Informe o diretório isolado usado no E2E sim.');
const data = realpathSync(supplied);
assert(data.startsWith(`${root}${path.sep}`), 'Recusado: diretório fora de .e2e-data.');
const db = new Database(path.join(data, 'fslm.db'), { readonly: true, fileMustExist: true });
const active = db.prepare("SELECT value FROM app_settings WHERE key='active_instance_id'").get();
const id = JSON.parse(active.value);
const instance = db.prepare('SELECT base_url FROM instances WHERE id=?').get(id);
assert(instance.base_url.endsWith('.freshservice.simulador.invalid'), 'Recusado: instância não sintética.');
const connection = db.prepare('SELECT status, secret_ref FROM connections WHERE instance_id=? ORDER BY id DESC LIMIT 1').get(id);
assert.deepEqual(connection, { status: 'disconnected', secret_ref: null });
const ticket = db.prepare("SELECT id FROM resources WHERE instance_id=? AND current_name='Ticket estabilizado sintético'").get(id);
assert(ticket, 'Execute primeiro o E2E 04-estabilizacao.');
const count = () => db.prepare('SELECT count(*) AS n FROM resource_versions rv JOIN resources r ON r.id=rv.resource_id WHERE r.instance_id=?').get(id).n;
const before = count();
const origin = 'http://127.0.0.1:3112';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3112'], {
  env: { ...process.env, FSLM_DATA_DIR: data, FSLM_SIMULATOR: '1', PORT: '3112', NEXT_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let browser;
let serverFailure = '';
server.stderr.on('data', (data) => { serverFailure += data.toString(); });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Servidor não iniciou (porta ocupada ou configuração inválida).');
    try { ready = (await fetch(`${origin}/api/health`)).ok; } catch { /* aguarda boot local */ }
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  assert(ready, 'Servidor local não ficou pronto.');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const unexpected = [];
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (['127.0.0.1', 'localhost'].includes(host)) return route.continue();
    unexpected.push(host);
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  const status = await (await fetch(`${origin}/api/connection/status`)).json();
  assert.equal(status.status, 'disconnected');
  assert.equal((await page.goto(`${origin}/tickets?q=Ticket%20estabilizado`)).status(), 200);
  assert.match(await page.locator('body').innerText(), /Ticket estabilizado sintético/);
  assert.equal((await page.goto(`${origin}/recursos/${ticket.id}`)).status(), 200);
  assert.equal(await page.locator('[aria-labelledby="versoes"] li').count(), 2);
  assert.equal((await page.goto(`${origin}/historico`)).status(), 200);
  assert.equal((await page.goto(`${origin}/diferencas`)).status(), 200);
  assert.match(await page.locator('body').innerText(), /Ticket estabilizado sintético/);
  assert.equal(count(), before, 'Reinício não pode alterar versões.');
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ synthetic: true, restart_offline: 'passed', preserved_versions: before }));
} finally {
  await browser?.close();
  db.close();
  const stopped = new Promise((resolve) => server.once('exit', resolve));
  if (server.exitCode === null) { server.kill('SIGTERM'); await stopped; }
}
