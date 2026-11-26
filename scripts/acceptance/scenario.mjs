/* eslint-env node */
/** Shared harness for the four chain conformance acceptance scenarios. */

const API_URL = (process.env.ACCEPTANCE_API_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const TOKEN = process.env.ACCEPTANCE_TOKEN || '';

export const config = { API_URL, TOKEN };

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...options.headers };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* non-JSON error response */
  }
  return { status: response.status, ok: response.ok, body, data: body?.data };
}

export async function run(scenario, fn) {
  console.log(`[acceptance] ${scenario}: START`);
  try {
    assert(TOKEN, 'ACCEPTANCE_TOKEN must be set (JWT of an ADMIN/MANAGER user)');
    await fn();
    console.log(`[acceptance] ${scenario}: PASS`);
  } catch (error) {
    console.error(`[acceptance] ${scenario}: FAIL - ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}

/** Extract the first anchor/escrow-release ledger event from a response body. */
export function findEvent(payload, names) {
  const items = Array.isArray(payload) ? payload : (payload?.blocks ?? payload?.events ?? payload?.data ?? []);
  return (Array.isArray(items) ? items : []).find(item => names.includes(item.name ?? item.event ?? item.type));
}
