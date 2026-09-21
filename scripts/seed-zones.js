"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../.env') });
if (process.env.NODE_ENV === 'production') {
    console.error('Zone seed script cannot be executed in production environment.');
    process.exit(1);
}
const zonePricingSetup_1 = require("../src/utils/zonePricingSetup");
const seedZones = async () => {
    try {
        const summary = await (0, zonePricingSetup_1.upsertZonesAndCountries)();
        console.log('Zone seed completed.');
        console.log(`Zones present: ${summary.totalZones}`);
        console.log(`New zones created: ${summary.createdZones}`);
        console.log(`Zone-country mappings present: ${summary.totalCountries}`);
        console.log(`New zone-country mappings created: ${summary.createdCountries}`);
        process.exit(0);
    }
    catch (error) {
        console.error('Zone seed failed:', error);
        process.exit(1);
    }
};
seedZones();
//# sourceMappingURL=seed-zones.js.map