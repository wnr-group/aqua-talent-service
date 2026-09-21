import dns from 'dns';
import path from 'path';
import mongoose from 'mongoose';

// Same workaround as src/db.js: some local/router DNS resolvers fail to
// answer SRV queries for mongodb+srv:// URIs even though they resolve fine
// via the OS stub resolver. Point Node's resolver at public DNS first.
dns.setServers(['8.8.8.8', '1.1.1.1']);

// Reuse the existing Mongoose models directly (they're plain CommonJS,
// TypeScript can require() them fine - see tsconfig.json, this folder is
// TS-only but is allowed to reach into the untouched src/models/*.js files).
const modelsDir = path.resolve(__dirname, '../../../src/models');

/* eslint-disable @typescript-eslint/no-var-requires */
export const models = {
  User: require(path.join(modelsDir, 'User')),
  Company: require(path.join(modelsDir, 'Company')),
  Student: require(path.join(modelsDir, 'Student')),
  JobPosting: require(path.join(modelsDir, 'JobPosting')),
  Application: require(path.join(modelsDir, 'Application')),
  AvailableService: require(path.join(modelsDir, 'AvailableService')),
  ActiveSubscription: require(path.join(modelsDir, 'ActiveSubscription')),
  PaymentRecord: require(path.join(modelsDir, 'PaymentRecord')),
  PayPerJobPurchase: require(path.join(modelsDir, 'PayPerJobPurchase')),
  Addon: require(path.join(modelsDir, 'Addon')),
  PlanZone: require(path.join(modelsDir, 'PlanZone')),
  SubscriptionAddon: require(path.join(modelsDir, 'SubscriptionAddon')),
  SubscriptionZone: require(path.join(modelsDir, 'SubscriptionZone')),
  Zone: require(path.join(modelsDir, 'Zone')),
  ZoneCountry: require(path.join(modelsDir, 'ZoneCountry')),
  SystemConfig: require(path.join(modelsDir, 'SystemConfig')),
  Notification: require(path.join(modelsDir, 'Notification')),
  NotificationPreference: require(path.join(modelsDir, 'NotificationPreference')),
  PasswordResetToken: require(path.join(modelsDir, 'PasswordResetToken'))
};
/* eslint-enable @typescript-eslint/no-var-requires */

export type ModelName = keyof typeof models;

let connected = false;

/**
 * Read-only connection to the source Mongo database. Deliberately does NOT
 * reuse src/db.js, which runs Student.updateMany() side effects on connect -
 * this migration tooling must never write to Mongo.
 */
export const connectMongo = async (): Promise<void> => {
  if (connected) {
    return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not configured');
  }

  await mongoose.connect(uri);
  connected = true;
};

export const disconnectMongo = async (): Promise<void> => {
  if (!connected) {
    return;
  }
  await mongoose.disconnect();
  connected = false;
};
