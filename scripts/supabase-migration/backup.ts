/**
 * Read-only logical backup of every Mongo collection used by this app.
 * mongodump/MongoDB Database Tools aren't installed on this machine, so this
 * dumps each collection to a JSON file instead - equivalent safety net,
 * restorable with a small companion script if ever needed, and it uses
 * tooling already in package.json (mongoose) instead of a new system install.
 *
 * Usage: npx tsc && node scripts/supabase-migration/backup.js
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { models, connectMongo, disconnectMongo } from './lib/mongo-models';

const run = async () => {
  await connectMongo();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(__dirname, '../../backups', `mongo-${timestamp}`);
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Backing up to ${outDir}\n`);

  let totalDocs = 0;

  for (const [name, model] of Object.entries(models)) {
    const docs = await model.find({}).lean();
    const collectionName = model.collection.name;
    const filePath = path.join(outDir, `${collectionName}.json`);

    fs.writeFileSync(filePath, JSON.stringify(docs, null, 2));
    console.log(`  ${name.padEnd(22)} -> ${collectionName}.json (${docs.length} docs)`);
    totalDocs += docs.length;
  }

  console.log(`\nBackup complete: ${totalDocs} total documents across ${Object.keys(models).length} collections.`);
  console.log(`Location: ${outDir}`);

  await disconnectMongo();
};

run()
  .catch((error) => {
    console.error('Backup failed:', error);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongo());
