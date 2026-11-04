import { readFile, appendFile } from 'node:fs/promises';

const sha = process.env.TARGET_SHA;
const composeId = process.env.DOKPLOY_COMPOSE_ID;
const base = process.env.DOKPLOY_URL;
const key = process.env.DOKPLOY_API_KEY;
if (!/^[a-f0-9]{40}$/.test(sha ?? '') || !composeId || !key || !base?.startsWith('https://')) throw new Error('Missing production promotion configuration');

/** Calls only the configured Dokploy API; response bodies and credentials are never logged. */
async function api(route, body, query) {
  const url = new URL(`/api/${route}`, base);
  for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
  const res = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'x-api-key': key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Dokploy ${route} returned HTTP ${res.status}`);
  const result = await res.json();
  return result.data ?? result;
}

/** Waits without logging container configuration, which can contain secret environment values. */
async function verify(appName) {
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    const containers = await api('docker.getContainersByAppNameMatch', null, { appName, appType: 'docker-compose' });
    const list = Array.isArray(containers) ? containers : containers.containers ?? [];
    const states = new Map();
    for (const container of list) {
      const config = await api('docker.getConfig', null, { containerId: container.containerId ?? container.Id ?? container.id });
      const data = Array.isArray(config) ? config[0] : config;
      const service = data.Config?.Labels?.['com.docker.compose.service'];
      if (!service) continue;
      const image = data.Config?.Image ?? '';
      if (!image.endsWith(`:${sha}`)) continue;
      states.set(service, { status: data.State?.Status, health: data.State?.Health?.Status, exit: data.State?.ExitCode });
    }
    const oneShots = ['migrate', 'verify'];
    if (oneShots.some(name => states.get(name)?.status === 'exited' && states.get(name)?.exit !== 0)) throw new Error('Migration or synthetic verification failed');
    const healthy = ['api', 'web', 'worker'].every(name => states.get(name)?.health === 'healthy');
    const finished = oneShots.every(name => states.get(name)?.status === 'exited' && states.get(name)?.exit === 0);
    if (healthy && finished) {
      const [health, web] = await Promise.all([fetch('https://clinix-api.thecontractor.me/health'), fetch('https://clinix.thecontractor.me/sign-in')]);
      const info = await health.json();
      if (health.ok && web.ok && info.revision === sha && info.db === 'up') return;
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  throw new Error('Production health and queued AI verification did not pass in time');
}

const current = await api('compose.one', null, { composeId });
if (current.name !== 'clinix-production' || current.sourceType !== 'raw') throw new Error('Refusing to update an unexpected Dokploy service');
const previous = current.composeFile?.match(/clinix-api:([a-f0-9]{40})/)?.[1] ?? 'not deployed';
let template = await readFile('infra/dokploy/docker-compose.yml', 'utf8');
template = template.replaceAll('${CLINIX_IMAGE_PREFIX:-ghcr.io/advaitr7/clinix}', 'ghcr.io/advaitr7/clinix').replaceAll('${CLINIX_IMAGE_TAG:?set immutable commit SHA}', sha);
try {
  // Deliberately omit env: production credentials are preserved in Dokploy.
  await api('compose.update', { composeId, composeFile: template, autoDeploy: false });
  await api('compose.deploy', { composeId, title: `CliniX ${sha}`, description: `Previous revision: ${previous}` });
  await verify(current.appName);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Promoted ${sha}\n\nPrevious: ${previous}\n\nAPI, web, worker, migrations and synthetic AI queue probe passed.\n`);
} catch (error) {
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Promotion failed for ${sha}. Previous revision: ${previous}. Inspect CliniX deployment logs; no database reversal was performed.\n`);
  throw error;
}
