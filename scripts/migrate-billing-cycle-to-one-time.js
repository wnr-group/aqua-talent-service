"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../.env') });
const client_1 = require("../src/lib/supabase/client");
// The Postgres schema's billing_cycle CHECK constraint only ever allows
// 'one-time' (supabase/migrations/20260921000004_students_and_plans.sql),
// so this is now a defensive idempotent normalization rather than a real
// migration - any stray legacy value (from the old Mongo 'monthly'/'yearly'/
// 'one_time' days) gets corrected to the one value the schema accepts.
const runMigration = async () => {
    try {
        const supabase = (0, client_1.getSupabaseClient)();
        const { data: strayRows } = await supabase.from('available_services').select('id, billing_cycle').neq('billing_cycle', 'one-time');
        if (!strayRows || !strayRows.length) {
            console.log('Billing cycle migration: nothing to do, all plans already use one-time.');
            process.exit(0);
        }
        const { data: updated, error } = await supabase
            .from('available_services')
            .update({ billing_cycle: 'one-time' })
            .in('id', strayRows.map((row) => row.id))
            .select('id');
        if (error)
            throw error;
        console.log('Billing cycle migration completed.');
        console.log(`Matched plans: ${strayRows.length}`);
        console.log(`Updated plans: ${updated?.length ?? 0}`);
        process.exit(0);
    }
    catch (error) {
        console.error('Billing cycle migration failed:', error);
        process.exit(1);
    }
};
runMigration();
//# sourceMappingURL=migrate-billing-cycle-to-one-time.js.map