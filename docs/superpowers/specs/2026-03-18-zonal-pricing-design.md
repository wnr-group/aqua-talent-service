# Zonal Pricing Feature Design

**Date:** 2026-03-18
**Status:** Approved
**Author:** Claude (AI Assistant)

## Overview

Add zone-based geographic access control to job listings. Students' subscription plans include access to specific zones. Jobs outside their zones show limited info with upgrade prompts.

## Requirements Summary

| Aspect | Decision |
|--------|----------|
| Zone-to-plan mapping | Admin-configurable, not hardcoded |
| Job-to-zone linking | Country dropdown (from zones) + free-text location |
| Zone-locked job behavior | Show in search, lock description/requirements |
| "All Remaining Zones" add-on | Unlocks all zones permanently (including future) |
| Extra job credits | Restricted to existing zone access |
| Free tier zones | All zones, limited by 2-app quota |
| Plan upgrade | Only when quota exhausted, fresh start |
| Zone add-ons on upgrade | Lost — tied to subscription |
| Pay Per Job | Standalone ₹2500 purchase, bypasses subscription |
| Admin management | APIs + panel needed |
| Zone-locked job options | Show all: zone add-on, pay per job, unlock all, pricing page |

## Zone Definitions

| Zone | Description | Countries |
|------|-------------|-----------|
| Zone 1 | Premium Markets / Corporate Hubs | USA, UK, Germany, Singapore, UAE |
| Zone 2 | Growing Markets | Canada, Japan, South Korea |
| Zone 3 | Emerging Markets | India, Brazil, Mexico, Vietnam, Indonesia |
| Zone 4 | Niche / Optional Markets | Norway, Denmark, Panama |

## Subscription Plans

| Plan | Price (INR) | Price (USD) | Applications | Zones |
|------|-------------|-------------|--------------|-------|
| Free | ₹0 | $0 | 2 | All (quota-limited) |
| Starter | ₹599 | $15-20 | 5 | Admin-configured (default 2) |
| Pro | ₹1,699 | $30-35 | 10-15 | Admin-configured (default 3) |
| Premium | ₹3,250 | $50-60 | Unlimited | All |

## Add-on Pricing

| Add-On | Price (INR) | Price (USD) | Description |
|--------|-------------|-------------|-------------|
| Single Extra Zone | ₹199 | $3 | Unlock one additional zone |
| 2-Zone Bundle | ₹349 | $5 | Unlock two additional zones |
| All Remaining Zones | ₹699 | $10 | Unlock all zones (current + future) |
| Extra Job Credits (Starter) | ₹99 | ~$1.50 | 3 additional applications |
| Extra Job Credits (Pro) | ₹149 | ~$2 | 5 additional applications |
| Pay Per Job | ₹2,500 | $35 | Apply to single job (bypasses subscription) |

---

## Data Model Changes

### 1. JobPosting — Add country field

```javascript
// Add to existing JobPosting schema
countryId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'ZoneCountry',
  default: null  // Optional for backward compatibility
}
// Keep existing `location` field for free-text display
```

### 2. Addon — Add unlockAllZones flag and update validation

```javascript
// Add to existing Addon schema
unlockAllZones: {
  type: Boolean,
  default: false  // When true, grants access to all zones
}

// UPDATE existing pre-validate hook to allow unlockAllZones addons:
// - When type === 'zone' AND unlockAllZones === true, zoneCount is NOT required
// - When type === 'zone' AND unlockAllZones === false, zoneCount IS required
```

**Validation Logic Update:**
```javascript
AddonSchema.pre('validate', function() {
  if (this.type === 'zone') {
    // unlockAllZones addons don't need zoneCount
    if (!this.unlockAllZones) {
      if (!isPresent(this.zoneCount) || this.zoneCount <= 0) {
        this.invalidate('zoneCount', 'Zone addon must define zoneCount (unless unlockAllZones)');
      }
    }
    if (isPresent(this.jobCreditCount)) {
      this.invalidate('jobCreditCount', 'Zone addon cannot define jobCreditCount');
    }
  }
  // ... rest of validation unchanged
});
```

### 3. New Model: PayPerJobPurchase

```javascript
const PayPerJobPurchaseSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  jobPostingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JobPosting',
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    enum: ['INR', 'USD'],
    required: true
  },
  paymentRecordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PaymentRecord',
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date,
    default: null  // Set when status changes to 'completed'
  }
}, {
  collection: 'pay_per_job_purchases'
});

// Unique constraint only on completed purchases - allows retrying failed purchases
PayPerJobPurchaseSchema.index(
  { studentId: 1, jobPostingId: 1 },
  { unique: true, partialFilterExpression: { status: 'completed' } }
);
PayPerJobPurchaseSchema.index({ studentId: 1 });
PayPerJobPurchaseSchema.index({ status: 1 });
```

**Retry Logic:** If a student has a `pending` or `failed` PayPerJobPurchase, a new purchase attempt should update the existing record rather than creating a new one. Only `completed` purchases enforce uniqueness.

### 4. AvailableService — Add allZonesIncluded flag

```javascript
// Add to existing AvailableService schema
allZonesIncluded: {
  type: Boolean,
  default: false  // true for Free and Premium plans
}
```

**Note:** The number of zones included is computed dynamically from `PlanZone` count. The `allZonesIncluded` flag is used to:
1. Grant all-zone access without checking PlanZone entries
2. Display "All Zones" on pricing page instead of a count
3. Handle Free tier and Premium plan zone access

### Existing Models (No Changes Needed)

- `Zone` — stores zone definitions
- `ZoneCountry` — maps countries to zones
- `PlanZone` — maps zones to plans (admin-configurable)
- `SubscriptionZone` — tracks zones a subscription has access to
- `Addon` — defines add-ons (extended with unlockAllZones)
- `SubscriptionAddon` — tracks purchased add-ons

---

## Zone Access Logic

### Determining Accessible Zones

```javascript
async function getAccessibleZones(studentId) {
  const student = await Student.findById(studentId);
  if (!student) {
    return { allZones: false, zoneIds: [] };
  }

  const subscription = await ActiveSubscription.findById(student.currentSubscriptionId)
    .populate('serviceId', 'allZonesIncluded');

  if (!subscription) {
    return { allZones: false, zoneIds: [] };
  }

  // Check if plan grants all zones (Free tier, Premium, etc.)
  if (subscription.serviceId?.allZonesIncluded) {
    return { allZones: true };
  }

  // Check for "unlock all zones" addon
  const unlockAllAddonIds = await Addon.find({ unlockAllZones: true }).distinct('_id');
  const hasUnlockAll = await SubscriptionAddon.exists({
    subscriptionId: subscription._id,
    addonId: { $in: unlockAllAddonIds }
  });

  if (hasUnlockAll) {
    return { allZones: true };
  }

  // Get zones from plan + individual addons via SubscriptionZone
  const zoneIds = await SubscriptionZone.find({
    subscriptionId: subscription._id
  }).distinct('zoneId');

  return { allZones: false, zoneIds };
}
```

**Note:** Zone access is determined by:
1. `AvailableService.allZonesIncluded` flag on the plan (for Free/Premium)
2. "Unlock All Zones" addon purchase
3. Specific zones in `SubscriptionZone` (from plan assignments + zone add-ons)

### Checking Job Access

```javascript
async function canAccessJob(studentId, jobPostingId) {
  // Check Pay Per Job purchase first
  const payPerJob = await PayPerJobPurchase.findOne({
    studentId,
    jobPostingId,
    status: 'completed'
  });
  if (payPerJob) return { canAccess: true, source: 'pay-per-job' };

  const job = await JobPosting.findById(jobPostingId).populate('countryId');

  // Jobs without country set are accessible to all
  if (!job.countryId) return { canAccess: true, source: 'no-zone-restriction' };

  const jobZoneId = job.countryId.zoneId;
  const access = await getAccessibleZones(studentId);

  if (access.allZones) return { canAccess: true, source: 'all-zones' };
  if (access.zoneIds.some(id => id.equals(jobZoneId))) {
    return { canAccess: true, source: 'subscription' };
  }

  return { canAccess: false, requiredZoneId: jobZoneId };
}
```

---

## API Endpoints

### Student APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /student/jobs/:jobId` | GET | Returns job with `isZoneLocked` flag |
| `POST /student/jobs/:jobId/apply` | POST | Checks zone access before allowing |
| `GET /student/subscription/zones` | GET | Returns student's accessible zones |
| `GET /student/zone-addons` | GET | Lists available zone add-ons |
| `POST /student/zone-addons/purchase` | POST | Purchase a zone add-on |
| `POST /student/pay-per-job/:jobId` | POST | Initiate pay-per-job purchase |

### Admin APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /admin/zones` | GET | List all zones with countries |
| `POST /admin/zones` | POST | Create a new zone |
| `PATCH /admin/zones/:zoneId` | PATCH | Update zone details |
| `DELETE /admin/zones/:zoneId` | DELETE | Delete zone (if not referenced) |
| `POST /admin/zones/:zoneId/countries` | POST | Add country to zone |
| `DELETE /admin/zones/:zoneId/countries/:countryId` | DELETE | Remove country |
| `GET /admin/plans/:planId/zones` | GET | Get zones for a plan |
| `PUT /admin/plans/:planId/zones` | PUT | Set zones for a plan |
| `GET /admin/addons` | GET | List all add-ons |
| `POST /admin/addons` | POST | Create add-on |
| `PATCH /admin/addons/:addonId` | PATCH | Update add-on |
| `DELETE /admin/addons/:addonId` | DELETE | Delete add-on |

### Company APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /company/jobs` | POST | Include `countryId` field |
| `PATCH /company/jobs/:jobId` | PATCH | Allow updating `countryId` |
| `GET /company/countries` | GET | List countries for dropdown |

---

## Job Listing & Detail Behavior

### Job Search (GET /student/jobs)

- Returns all approved jobs regardless of zone access
- Each job includes `isZoneLocked: Boolean` flag
- Zone-locked jobs show: title, company, location, job type, salary
- Students can discover jobs and be motivated to upgrade

### Job Detail (GET /student/jobs/:jobId)

When zone is locked:
```json
{
  "id": "...",
  "title": "Database Administrator",
  "description": null,
  "requirements": null,
  "location": "New York, USA",
  "jobType": "Full-time",
  "salaryRange": "₹12,00,000 - ₹18,00,000",
  "company": { "..." },
  "isZoneLocked": true,
  "zoneLockReason": {
    "zone": { "id": "...", "name": "Zone 1 - Premium Markets" },
    "unlockOptions": [
      { "type": "zone-addon", "name": "Single Extra Zone", "priceINR": 199, "priceUSD": 3 },
      { "type": "unlock-all-zones", "name": "All Remaining Zones", "priceINR": 699, "priceUSD": 10 },
      { "type": "pay-per-job", "priceINR": 2500, "priceUSD": 35 },
      { "type": "upgrade-plan", "url": "/pricing" }
    ]
  },
  "hasApplied": false,
  "applicationStatus": null
}
```

### Apply Validation Order

1. Check if already applied → 400 "Already applied"
2. Check zone access → 403 "Zone locked" with unlock options
3. Check quota remaining → 403 "Quota exhausted" with upgrade options
4. Allow application → 201 Created

---

## Payment Flows

### Zone Add-on Purchase

1. Student selects add-on → `POST /student/zone-addons/purchase`
2. Create Razorpay order
3. Student completes payment
4. On success:
   - Create PaymentRecord
   - Create SubscriptionAddon
   - Create SubscriptionZone entries (or mark unlockAllZones)
5. Student can access new zone(s)

**Request Schema:**
```json
{
  "addonId": "ObjectId",
  "zoneIds": ["ObjectId", "ObjectId"]  // Required for single/bundle zone addons
                                        // Ignored for unlockAllZones addons
}
```

**Validation:**
- For single zone addon: `zoneIds.length === 1`
- For 2-zone bundle: `zoneIds.length === 2`
- For unlockAllZones addon: `zoneIds` is ignored
- Cannot select zones already accessible to the student

### Pay Per Job Purchase

1. Student clicks "Pay ₹2500" → `POST /student/pay-per-job/:jobId`
2. Validate job exists, not already purchased
3. Create Razorpay order
4. Student completes payment
5. On success:
   - Create PaymentRecord
   - Create PayPerJobPurchase (status: completed)
6. Student can view/apply (does NOT consume quota)

### Extra Job Credits Purchase

1. Student selects credits → `POST /student/job-credits/purchase`
2. Create Razorpay order
3. On success:
   - Create PaymentRecord
   - Create SubscriptionAddon (type: jobs)
   - Increase subscription's maxApplications
4. Student has more applications

---

## Migration & Backward Compatibility

### Existing Jobs
- Jobs without `countryId` are accessible to all (no zone restriction)
- Admin can gradually assign countries to existing jobs

### Existing Subscriptions
- Continue to work as-is
- Run `ensureSubscriptionZonesForPlan()` for existing subscriptions
- Populates SubscriptionZone based on plan's current zone assignments

### Existing Plans
- Need zone assignments via admin panel
- Until configured, plan holders have no zone restrictions

### Feature Flag
- `ZONE_ENFORCEMENT_ENABLED` environment variable
- `false`: All jobs accessible (current behavior)
- `true`: Zone access checks enforced
- Allows gradual rollout after admin configuration

---

## Frontend Implementation Guide

### Student-Facing Changes

**Job Listing Page:**
- Show lock icon on zone-locked jobs
- Visual distinction (faded/badge) for locked jobs

**Job Detail Page:**
- If unlocked: show full details
- If locked: hide description/requirements, show upgrade panel with 4 options

**Subscription Page:**
- "Your Zones" section
- Zone add-on purchase options

**Pricing Page:**
- Show "X Zones Included" per plan
- List zones for each plan
- Zone add-on options

### Admin Panel Changes

**Zone Management:**
- CRUD for zones
- Manage countries per zone

**Add-on Management:**
- CRUD for add-ons
- Support zone/jobs/unlockAllZones types

**Plan Management:**
- Zone assignment via multi-select
- Display zone count

### Company Portal Changes

**Job Posting Form:**
- Add Country dropdown (required for new jobs when zone enforcement is enabled)
- Fetch from `GET /company/countries`
- Keep Location as free-text for specific address/office details
- Show warning if country not selected: "Jobs without a country will be visible to all students"

**Note on countryId requirement:**
- When `ZONE_ENFORCEMENT_ENABLED=false`: `countryId` is optional
- When `ZONE_ENFORCEMENT_ENABLED=true`: `countryId` is required for new jobs
- Existing jobs without `countryId` remain accessible to all (backward compatible)

---

## Open Questions

None — all requirements clarified during brainstorming.

---

## Appendix: Existing Models Reference

The following models already exist and will be reused:

- `Zone` — src/models/Zone.js
- `ZoneCountry` — src/models/ZoneCountry.js
- `PlanZone` — src/models/PlanZone.js
- `SubscriptionZone` — src/models/SubscriptionZone.js
- `Addon` — src/models/Addon.js
- `SubscriptionAddon` — src/models/SubscriptionAddon.js
