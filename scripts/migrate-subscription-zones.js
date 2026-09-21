"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Backfill script: populate subscription_zones for active subscriptions that
 * don't have any yet (e.g. ones created before zone tracking existed).
 * Run with: npx tsc && node scripts/migrate-subscription-zones.js
 */
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../.env') });
const client_1 = require("../src/lib/supabase/client");
const zonePricingService_1 = require("../src/services/zonePricingService");
const migrate = async () => {
    const supabase = (0, client_1.getSupabaseClient)();
    const { data: subscriptions, error } = await supabase
        .from('active_subscriptions')
        .select('id, service_id')
        .eq('status', 'active');
    if (error)
        throw error;
    console.log(`Found ${subscriptions?.length ?? 0} active subscriptions`);
    let migrated = 0;
    let skipped = 0;
    for (const sub of subscriptions || []) {
        const { count: existingZones } = await supabase
            .from('subscription_zones')
            .select('*', { count: 'exact', head: true })
            .eq('subscription_id', sub.id);
        if ((existingZones ?? 0) > 0) {
            skipped++;
            continue;
        }
        const created = await (0, zonePricingService_1.ensureSubscriptionZonesForPlan)({ subscriptionId: sub.id, serviceId: sub.service_id });
        if (created > 0) {
            migrated++;
            console.log(`Migrated subscription ${sub.id}: ${created} zones`);
        }
        else {
            skipped++;
        }
    }
    console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped`);
};
migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
//# sourceMappingURL=migrate-subscription-zones.js.map