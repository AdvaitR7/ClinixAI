import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** Downloads a bounded page of object metadata using only the server credential. */
async function listObjects(prefix, offset) {
  const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/list/clinix-documents`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, offset, limit: 100, sortBy: { column: 'name', order: 'asc' } }), signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Storage listing failed');
  return response.json();
}

/** Copies original document bytes to hashed local names and records paths only in the encrypted backup. */
async function copyObjects(folder, prefix, manifest) {
  for (let offset = 0; ; offset += 100) {
    const objects = await listObjects(prefix, offset);
    for (const object of objects) {
      const name = prefix ? `${prefix}/${object.name}` : object.name;
      if (!object.id) { await copyObjects(folder, name, manifest); continue; }
      const localName = createHash('sha256').update(name).digest('hex');
      const path = join(folder, 'objects', localName);
      const response = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/clinix-documents/${name.split('/').map(encodeURIComponent).join('/')}`, {
        headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY }, signal: AbortSignal.timeout(120000),
      });
      if (!response.ok || !response.body) throw new Error('Storage object download failed');
      const hash = createHash('sha256');
      await pipeline(Readable.fromWeb(response.body).on('data', chunk => hash.update(chunk)), createWriteStream(path, { mode: 0o600 }));
      manifest.objects.push({ bucket: 'clinix-documents', name, file: `objects/${localName}`, sha256: hash.digest('hex'), size: (await stat(path)).size });
    }
    if (objects.length < 100) break;
  }
}

/** Creates a database dump and document snapshot, uploads offsite, and writes the success marker last. */
async function main() {
  for (const name of ['BACKUP_DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BACKUP_S3_URI', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']) {
    if (!process.env[name]) throw new Error('Missing backup configuration');
  }
  if (!process.env.BACKUP_S3_URI.startsWith('s3://')) throw new Error('Backup destination must be S3');
  const folder = await mkdtemp(join(tmpdir(), 'clinix-backup-'));
  const date = new Date();
  const stamp = date.toISOString().replaceAll(':', '-');
  const manifest = { created_at: date.toISOString(), revision: process.env.GIT_SHA ?? 'unknown', objects: [] };
  try {
    await mkdir(join(folder, 'objects'), { mode: 0o700 });
    // PGDATABASE keeps the connection string out of child-process arguments and ordinary process listings.
    execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', join(folder, 'database.dump')], {
      env: { ...process.env, PGDATABASE: process.env.BACKUP_DATABASE_URL }, stdio: 'pipe', timeout: 1800000,
    });
    await copyObjects(folder, '', manifest);
    const databaseHash = createHash('sha256');
    for await (const chunk of createReadStream(join(folder, 'database.dump'))) databaseHash.update(chunk);
    manifest.database_sha256 = databaseHash.digest('hex');
    await writeFile(join(folder, 'manifest.json'), JSON.stringify(manifest), { mode: 0o600 });
    const target = `${process.env.BACKUP_S3_URI.replace(/\/$/, '')}/daily/${stamp}`;
    const endpoint = process.env.AWS_ENDPOINT_URL ? ['--endpoint-url', process.env.AWS_ENDPOINT_URL] : [];
    execFileSync('aws', [...endpoint, 's3', 'cp', folder, target, '--recursive', '--only-show-errors', '--sse', 'AES256'], { stdio: 'pipe', timeout: 1800000 });
    if (date.getUTCDate() === 1) execFileSync('aws', [...endpoint, 's3', 'cp', target, target.replace('/daily/', '/monthly/'), '--recursive', '--only-show-errors', '--sse', 'AES256'], { stdio: 'pipe', timeout: 1800000 });
    await writeFile(join(folder, 'last-success.json'), JSON.stringify({ completed_at: new Date().toISOString(), snapshot: stamp }));
    execFileSync('aws', [...endpoint, 's3', 'cp', join(folder, 'last-success.json'), `${process.env.BACKUP_S3_URI.replace(/\/$/, '')}/last-success.json`, '--only-show-errors', '--sse', 'AES256'], { stdio: 'pipe' });
    console.log('CliniX offsite database and document backup completed.');
  } finally { await rm(folder, { recursive: true, force: true }); }
}
main().catch(() => { console.error('CliniX offsite backup FAILED; success marker was not updated.'); process.exitCode = 1; });
