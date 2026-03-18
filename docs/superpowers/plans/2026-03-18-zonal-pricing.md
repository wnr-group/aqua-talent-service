# Zonal Pricing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add zone-based geographic access control to job listings with add-on purchase capabilities.

**Architecture:** Extend existing subscription system with zone access checks. Jobs link to countries (which belong to zones). Students can access jobs in their plan's zones or purchase add-ons for additional access. Pay-per-job bypasses zone restrictions for individual jobs.

**Tech Stack:** Node.js, Express, Mongoose, Razorpay (existing)

**Spec:** `docs/superpowers/specs/2026-03-18-zonal-pricing-design.md`

---

## File Structure

### New Files
- `src/models/PayPerJobPurchase.js` — Pay-per-job purchase tracking
- `src/services/zoneAccessService.js` — Zone access logic (getAccessibleZones, canAccessJob)
- `src/controllers/zoneController.js` — Admin zone management endpoints
- `src/controllers/addonController.js` — Admin addon management endpoints
- `src/routes/zoneRoutes.js` — Admin zone routes

### Modified Files
- `src/models/JobPosting.js` — Add `countryId` field
- `src/models/Addon.js` — Add `unlockAllZones` field, update validation
- `src/models/AvailableService.js` — Add `allZonesIncluded` field
- `src/controllers/studentController.js` — Zone locking in getJob, getJobs, applyToJob
- `src/controllers/companyController.js` — Add countryId to job creation/update, countries endpoint
- `src/controllers/adminController.js` — Plan zone management
- `src/controllers/paymentController.js` — Zone addon and pay-per-job purchase flows
- `src/routes/studentRoutes.js` — New zone-related endpoints
- `src/routes/companyRoutes.js` — Countries endpoint
- `src/routes/adminRoutes.js` — Zone and addon management routes
- `src/services/zonePricingService.js` — Extend with zone addon logic

---

## Chunk 1: Data Model Updates

### Task 1: Add countryId to JobPosting model

**Files:**
- Modify: `src/models/JobPosting.js`

- [ ] **Step 1: Add countryId field to JobPosting schema**

```javascript
// In src/models/JobPosting.js, add after 'location' field (around line 34):
  countryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ZoneCountry',
    default: null
  },
```

- [ ] **Step 2: Add index for countryId**

```javascript
// Add after existing indexes (around line 72):
JobPostingSchema.index({ countryId: 1 });
```

- [ ] **Step 3: Commit**

```bash
git add src/models/JobPosting.js
git commit -m "feat(models): add countryId field to JobPosting for zone linking"
```

---

### Task 2: Add unlockAllZones to Addon model and update validation

**Files:**
- Modify: `src/models/Addon.js`

- [ ] **Step 1: Add unlockAllZones field to Addon schema**

```javascript
// In src/models/Addon.js, add after 'jobCreditCount' field (around line 36):
  unlockAllZones: {
    type: Boolean,
    default: false
  },
```

- [ ] **Step 2: Update pre-validate hook to allow unlockAllZones addons**

Replace the existing pre-validate hook (lines 45-65) with:

```javascript
AddonSchema.pre('validate', function() {
  if (this.type === 'jobs') {
    if (!isPresent(this.jobCreditCount) || this.jobCreditCount <= 0) {
      this.invalidate('jobCreditCount', 'Jobs addon must define jobCreditCount');
    }

    if (isPresent(this.zoneCount)) {
      this.invalidate('zoneCount', 'Jobs addon cannot define zoneCount');
    }
  }

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
});
```

- [ ] **Step 3: Add index for unlockAllZones**

```javascript
// Add after existing indexes:
AddonSchema.index({ unlockAllZones: 1 });
```

- [ ] **Step 4: Commit**

```bash
git add src/models/Addon.js
git commit -m "feat(models): add unlockAllZones flag to Addon with updated validation"
```

---

### Task 3: Add allZonesIncluded to AvailableService model

**Files:**
- Modify: `src/models/AvailableService.js`

- [ ] **Step 1: Add allZonesIncluded field**

```javascript
// In src/models/AvailableService.js, add after 'isActive' field (around line 140):
  allZonesIncluded: {
    type: Boolean,
    default: false
  },
```

- [ ] **Step 2: Update getFreePlan static method to set allZonesIncluded**

In the `freePlanDefaults` object inside `getFreePlan` method, add:

```javascript
    allZonesIncluded: true,
```

And add to the hasUpdates check:

```javascript
    if (!freePlan.allZonesIncluded) {
      freePlan.allZonesIncluded = true;
      hasUpdates = true;
    }
```

- [ ] **Step 3: Commit**

```bash
git add src/models/AvailableService.js
git commit -m "feat(models): add allZonesIncluded flag to AvailableService"
```

---

### Task 4: Create PayPerJobPurchase model

**Files:**
- Create: `src/models/PayPerJobPurchase.js`

- [ ] **Step 1: Create the PayPerJobPurchase model file**

```javascript
const mongoose = require('mongoose');

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
    required: true,
    min: 0
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
  razorpayOrderId: {
    type: String,
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
    default: null
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
PayPerJobPurchaseSchema.index({ jobPostingId: 1 });
PayPerJobPurchaseSchema.index({ status: 1 });
PayPerJobPurchaseSchema.index({ razorpayOrderId: 1 });

module.exports = mongoose.model('PayPerJobPurchase', PayPerJobPurchaseSchema);
```

- [ ] **Step 2: Export from models index**

Add to `src/models/index.js`:

```javascript
const PayPerJobPurchase = require('./PayPerJobPurchase');

// In the exports object:
  PayPerJobPurchase,
```

- [ ] **Step 3: Commit**

```bash
git add src/models/PayPerJobPurchase.js src/models/index.js
git commit -m "feat(models): add PayPerJobPurchase model for pay-per-job purchases"
```

---

## Chunk 2: Zone Access Service

### Task 5: Create zoneAccessService

**Files:**
- Create: `src/services/zoneAccessService.js`

- [ ] **Step 1: Create the zone access service file**

```javascript
const mongoose = require('mongoose');

const Student = require('../models/Student');
const ActiveSubscription = require('../models/ActiveSubscription');
const Addon = require('../models/Addon');
const SubscriptionAddon = require('../models/SubscriptionAddon');
const SubscriptionZone = require('../models/SubscriptionZone');
const JobPosting = require('../models/JobPosting');
const PayPerJobPurchase = require('../models/PayPerJobPurchase');
const Zone = require('../models/Zone');

const isZoneEnforcementEnabled = () => {
  return process.env.ZONE_ENFORCEMENT_ENABLED === 'true';
};

const getAccessibleZones = async (studentId) => {
  if (!isZoneEnforcementEnabled()) {
    return { allZones: true, zoneIds: [] };
  }

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
    return { allZones: true, zoneIds: [] };
  }

  // Check for "unlock all zones" addon
  const unlockAllAddonIds = await Addon.find({ unlockAllZones: true }).distinct('_id');
  if (unlockAllAddonIds.length > 0) {
    const hasUnlockAll = await SubscriptionAddon.exists({
      subscriptionId: subscription._id,
      addonId: { $in: unlockAllAddonIds }
    });

    if (hasUnlockAll) {
      return { allZones: true, zoneIds: [] };
    }
  }

  // Get zones from plan + individual addons via SubscriptionZone
  const zoneIds = await SubscriptionZone.find({
    subscriptionId: subscription._id
  }).distinct('zoneId');

  return { allZones: false, zoneIds };
};

const canAccessJob = async (studentId, jobPostingId) => {
  if (!isZoneEnforcementEnabled()) {
    return { canAccess: true, source: 'zone-enforcement-disabled' };
  }

  // Check Pay Per Job purchase first
  const payPerJob = await PayPerJobPurchase.findOne({
    studentId,
    jobPostingId,
    status: 'completed'
  });
  if (payPerJob) {
    return { canAccess: true, source: 'pay-per-job' };
  }

  const job = await JobPosting.findById(jobPostingId).populate('countryId');

  // Jobs without country set are accessible to all
  if (!job || !job.countryId) {
    return { canAccess: true, source: 'no-zone-restriction' };
  }

  const jobZoneId = job.countryId.zoneId;
  const access = await getAccessibleZones(studentId);

  if (access.allZones) {
    return { canAccess: true, source: 'all-zones' };
  }

  const hasAccess = access.zoneIds.some(id => id.equals(jobZoneId));
  if (hasAccess) {
    return { canAccess: true, source: 'subscription' };
  }

  // Get zone details for the lock reason
  const zone = await Zone.findById(jobZoneId).select('name');

  return {
    canAccess: false,
    requiredZoneId: jobZoneId,
    zoneName: zone?.name || 'Unknown Zone'
  };
};

const getUnlockOptions = async (zoneId) => {
  const Addon = require('../models/Addon');

  const addons = await Addon.find({
    type: 'zone',
    $or: [
      { zoneCount: { $gte: 1 } },
      { unlockAllZones: true }
    ]
  }).select('name priceINR priceUSD zoneCount unlockAllZones').lean();

  const options = [];

  // Single zone addon
  const singleZone = addons.find(a => a.zoneCount === 1 && !a.unlockAllZones);
  if (singleZone) {
    options.push({
      type: 'zone-addon',
      addonId: singleZone._id,
      name: singleZone.name,
      priceINR: singleZone.priceINR,
      priceUSD: singleZone.priceUSD
    });
  }

  // Unlock all zones addon
  const unlockAll = addons.find(a => a.unlockAllZones);
  if (unlockAll) {
    options.push({
      type: 'unlock-all-zones',
      addonId: unlockAll._id,
      name: unlockAll.name,
      priceINR: unlockAll.priceINR,
      priceUSD: unlockAll.priceUSD
    });
  }

  // Pay per job option (hardcoded pricing as per spec)
  options.push({
    type: 'pay-per-job',
    priceINR: 2500,
    priceUSD: 35
  });

  // Upgrade plan option
  options.push({
    type: 'upgrade-plan',
    url: '/pricing'
  });

  return options;
};

module.exports = {
  isZoneEnforcementEnabled,
  getAccessibleZones,
  canAccessJob,
  getUnlockOptions
};
```

- [ ] **Step 2: Commit**

```bash
git add src/services/zoneAccessService.js
git commit -m "feat(services): add zoneAccessService for zone access logic"
```

---

## Chunk 3: Student Controller Updates

### Task 6: Update getJob to include zone locking

**Files:**
- Modify: `src/controllers/studentController.js`

- [ ] **Step 1: Import zoneAccessService at top of file**

```javascript
const { canAccessJob, getUnlockOptions, isZoneEnforcementEnabled } = require('../services/zoneAccessService');
const Zone = require('../models/Zone');
```

- [ ] **Step 2: Update getJob function to check zone access**

In the `getJob` function, after the existing `isDescriptionLocked` logic for quota, add zone checking. Find where `isDescriptionLocked` is set and add:

```javascript
        // Zone access check (after quota check)
        let isZoneLocked = false;
        let zoneLockReason = null;

        if (!isDescriptionLocked && isZoneEnforcementEnabled()) {
          const zoneAccess = await canAccessJob(student._id, jobId);
          if (!zoneAccess.canAccess) {
            isZoneLocked = true;
            const unlockOptions = await getUnlockOptions(zoneAccess.requiredZoneId);
            zoneLockReason = {
              zone: {
                id: zoneAccess.requiredZoneId,
                name: zoneAccess.zoneName
              },
              unlockOptions
            };
          }
        }

        // Combine quota lock and zone lock
        const isLocked = isDescriptionLocked || isZoneLocked;
```

Then update the response to include zone lock info:

```javascript
    res.json({
      id: jobObj._id,
      title: jobObj.title,
      description: isLocked ? null : jobObj.description,
      requirements: isLocked ? null : jobObj.requirements,
      // ... other fields ...
      isDescriptionLocked: isLocked,
      isZoneLocked,
      zoneLockReason,
      hasApplied,
      applicationStatus
    });
```

- [ ] **Step 3: Commit**

```bash
git add src/controllers/studentController.js
git commit -m "feat(student): add zone locking to getJob endpoint"
```

---

### Task 7: Update getJobs to include isZoneLocked flag

**Files:**
- Modify: `src/controllers/studentController.js`

- [ ] **Step 1: Update getJobs to check zone access for each job**

In the `getJobs` function, after fetching jobs, add zone checking for authenticated students:

```javascript
    // After transformedJobs is created, add zone lock status
    let jobsWithZoneStatus = transformedJobs;

    if (req.user && req.user.userType === 'student' && isZoneEnforcementEnabled()) {
      const student = await Student.findOne({ userId: req.user.userId });
      if (student) {
        const zoneAccessPromises = transformedJobs.map(async (job) => {
          const zoneAccess = await canAccessJob(student._id, job.id);
          return {
            ...job,
            isZoneLocked: !zoneAccess.canAccess
          };
        });
        jobsWithZoneStatus = await Promise.all(zoneAccessPromises);
      }
    }

    res.json({
      jobs: jobsWithZoneStatus,
      pagination: {
        // ... existing pagination
      }
    });
```

- [ ] **Step 2: Commit**

```bash
git add src/controllers/studentController.js
git commit -m "feat(student): add isZoneLocked flag to job listings"
```

---

### Task 8: Update applyToJob to check zone access

**Files:**
- Modify: `src/controllers/studentController.js`

- [ ] **Step 1: Add zone access check in applyToJob**

In the `applyToJob` function, after the quota check and before creating the application, add:

```javascript
    // Zone access check
    if (isZoneEnforcementEnabled()) {
      const zoneAccess = await canAccessJob(student._id, jobId);
      if (!zoneAccess.canAccess) {
        const unlockOptions = await getUnlockOptions(zoneAccess.requiredZoneId);
        return res.status(403).json({
          error: 'This job is in a zone not included in your plan.',
          isZoneLocked: true,
          zoneLockReason: {
            zone: {
              id: zoneAccess.requiredZoneId,
              name: zoneAccess.zoneName
            },
            unlockOptions
          }
        });
      }
    }
```

- [ ] **Step 2: Commit**

```bash
git add src/controllers/studentController.js
git commit -m "feat(student): add zone access check to applyToJob"
```

---

## Chunk 4: Company Controller Updates

### Task 9: Add countryId to job creation and update

**Files:**
- Modify: `src/controllers/companyController.js`

- [ ] **Step 1: Import ZoneCountry model**

```javascript
const ZoneCountry = require('../models/ZoneCountry');
```

- [ ] **Step 2: Update createJob to accept countryId**

In the job creation function, add countryId to the allowed fields:

```javascript
    // Validate countryId if provided
    if (countryId) {
      if (!mongoose.Types.ObjectId.isValid(countryId)) {
        return res.status(400).json({ error: 'Invalid country ID format' });
      }
      const country = await ZoneCountry.findById(countryId);
      if (!country) {
        return res.status(400).json({ error: 'Country not found' });
      }
    }

    const job = await JobPosting.create({
      // ... existing fields ...
      countryId: countryId || null
    });
```

- [ ] **Step 3: Update updateJob to allow changing countryId**

```javascript
    if (countryId !== undefined) {
      if (countryId === null) {
        job.countryId = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(countryId)) {
          return res.status(400).json({ error: 'Invalid country ID format' });
        }
        const country = await ZoneCountry.findById(countryId);
        if (!country) {
          return res.status(400).json({ error: 'Country not found' });
        }
        job.countryId = countryId;
      }
      hasUpdates = true;
    }
```

- [ ] **Step 4: Commit**

```bash
git add src/controllers/companyController.js
git commit -m "feat(company): add countryId support to job creation and update"
```

---

### Task 10: Add getCountries endpoint for company

**Files:**
- Modify: `src/controllers/companyController.js`
- Modify: `src/routes/companyRoutes.js`

- [ ] **Step 1: Add getCountries function to companyController**

```javascript
exports.getCountries = async (req, res) => {
  try {
    const ZoneCountry = require('../models/ZoneCountry');
    const Zone = require('../models/Zone');

    const countries = await ZoneCountry.find()
      .populate('zoneId', 'name')
      .sort({ countryName: 1 })
      .lean();

    const formattedCountries = countries.map(c => ({
      id: c._id,
      name: c.countryName,
      zone: c.zoneId ? {
        id: c.zoneId._id,
        name: c.zoneId.name
      } : null
    }));

    res.json({ countries: formattedCountries });
  } catch (error) {
    console.error('Get countries error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 2: Add route in companyRoutes.js**

```javascript
router.get('/countries', companyController.getCountries);
```

- [ ] **Step 3: Commit**

```bash
git add src/controllers/companyController.js src/routes/companyRoutes.js
git commit -m "feat(company): add getCountries endpoint for job posting form"
```

---

## Chunk 5: Admin Zone Management

### Task 11: Create zone management endpoints in adminController

**Files:**
- Modify: `src/controllers/adminController.js`

- [ ] **Step 1: Import required models**

```javascript
const Zone = require('../models/Zone');
const ZoneCountry = require('../models/ZoneCountry');
const PlanZone = require('../models/PlanZone');
```

- [ ] **Step 2: Add getZones function**

```javascript
exports.getZones = async (req, res) => {
  try {
    const zones = await Zone.find().sort({ name: 1 }).lean();

    const zonesWithCountries = await Promise.all(zones.map(async (zone) => {
      const countries = await ZoneCountry.find({ zoneId: zone._id })
        .select('_id countryName')
        .sort({ countryName: 1 })
        .lean();

      return {
        id: zone._id,
        name: zone.name,
        description: zone.description,
        countries: countries.map(c => ({ id: c._id, name: c.countryName })),
        countryCount: countries.length
      };
    }));

    res.json({ zones: zonesWithCountries });
  } catch (error) {
    console.error('Get zones error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 3: Add createZone function**

```javascript
exports.createZone = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || !description) {
      return res.status(400).json({ error: 'Name and description are required' });
    }

    const existingZone = await Zone.findOne({ name: name.trim() });
    if (existingZone) {
      return res.status(409).json({ error: 'Zone with this name already exists' });
    }

    const zone = await Zone.create({
      name: name.trim(),
      description: description.trim()
    });

    res.status(201).json({
      id: zone._id,
      name: zone.name,
      description: zone.description,
      countries: [],
      countryCount: 0
    });
  } catch (error) {
    console.error('Create zone error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 4: Add updateZone function**

```javascript
exports.updateZone = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const { name, description } = req.body;

    if (!mongoose.Types.ObjectId.isValid(zoneId)) {
      return res.status(400).json({ error: 'Invalid zone ID' });
    }

    const zone = await Zone.findById(zoneId);
    if (!zone) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    if (name !== undefined) {
      const existingZone = await Zone.findOne({
        name: name.trim(),
        _id: { $ne: zoneId }
      });
      if (existingZone) {
        return res.status(409).json({ error: 'Zone with this name already exists' });
      }
      zone.name = name.trim();
    }

    if (description !== undefined) {
      zone.description = description.trim();
    }

    await zone.save();

    res.json({
      id: zone._id,
      name: zone.name,
      description: zone.description
    });
  } catch (error) {
    console.error('Update zone error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 5: Add deleteZone function**

```javascript
exports.deleteZone = async (req, res) => {
  try {
    const { zoneId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(zoneId)) {
      return res.status(400).json({ error: 'Invalid zone ID' });
    }

    // Check if zone is referenced by any plans
    const planCount = await PlanZone.countDocuments({ zoneId });
    if (planCount > 0) {
      return res.status(400).json({
        error: 'Cannot delete zone that is assigned to plans',
        planCount
      });
    }

    // Check if zone has countries with jobs
    const countries = await ZoneCountry.find({ zoneId }).select('_id');
    const countryIds = countries.map(c => c._id);

    const JobPosting = require('../models/JobPosting');
    const jobCount = await JobPosting.countDocuments({ countryId: { $in: countryIds } });
    if (jobCount > 0) {
      return res.status(400).json({
        error: 'Cannot delete zone with countries that have jobs assigned',
        jobCount
      });
    }

    // Delete countries first, then zone
    await ZoneCountry.deleteMany({ zoneId });
    await Zone.findByIdAndDelete(zoneId);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete zone error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 6: Commit**

```bash
git add src/controllers/adminController.js
git commit -m "feat(admin): add zone CRUD endpoints"
```

---

### Task 12: Add country management endpoints

**Files:**
- Modify: `src/controllers/adminController.js`

- [ ] **Step 1: Add addCountryToZone function**

```javascript
exports.addCountryToZone = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const { countryName } = req.body;

    if (!mongoose.Types.ObjectId.isValid(zoneId)) {
      return res.status(400).json({ error: 'Invalid zone ID' });
    }

    if (!countryName || typeof countryName !== 'string') {
      return res.status(400).json({ error: 'Country name is required' });
    }

    const zone = await Zone.findById(zoneId);
    if (!zone) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    const existingCountry = await ZoneCountry.findOne({
      countryName: countryName.trim()
    });
    if (existingCountry) {
      return res.status(409).json({
        error: 'Country already exists',
        existingZoneId: existingCountry.zoneId
      });
    }

    const country = await ZoneCountry.create({
      zoneId,
      countryName: countryName.trim()
    });

    res.status(201).json({
      id: country._id,
      name: country.countryName,
      zoneId: country.zoneId
    });
  } catch (error) {
    console.error('Add country to zone error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 2: Add removeCountryFromZone function**

```javascript
exports.removeCountryFromZone = async (req, res) => {
  try {
    const { zoneId, countryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(zoneId) || !mongoose.Types.ObjectId.isValid(countryId)) {
      return res.status(400).json({ error: 'Invalid zone or country ID' });
    }

    const country = await ZoneCountry.findOne({ _id: countryId, zoneId });
    if (!country) {
      return res.status(404).json({ error: 'Country not found in this zone' });
    }

    // Check if any jobs reference this country
    const JobPosting = require('../models/JobPosting');
    const jobCount = await JobPosting.countDocuments({ countryId });
    if (jobCount > 0) {
      return res.status(400).json({
        error: 'Cannot remove country that has jobs assigned',
        jobCount
      });
    }

    await ZoneCountry.findByIdAndDelete(countryId);

    res.json({ success: true });
  } catch (error) {
    console.error('Remove country from zone error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 3: Commit**

```bash
git add src/controllers/adminController.js
git commit -m "feat(admin): add country management endpoints for zones"
```

---

### Task 13: Add plan zone management endpoints

**Files:**
- Modify: `src/controllers/adminController.js`

- [ ] **Step 1: Add getPlanZones function**

```javascript
exports.getPlanZones = async (req, res) => {
  try {
    const { planId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    const plan = await AvailableService.findById(planId);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const planZones = await PlanZone.find({ planId })
      .populate('zoneId', 'name description')
      .lean();

    const zones = planZones
      .filter(pz => pz.zoneId)
      .map(pz => ({
        id: pz.zoneId._id,
        name: pz.zoneId.name,
        description: pz.zoneId.description
      }));

    res.json({
      planId,
      planName: plan.name,
      allZonesIncluded: plan.allZonesIncluded,
      zones
    });
  } catch (error) {
    console.error('Get plan zones error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 2: Add setPlanZones function**

```javascript
exports.setPlanZones = async (req, res) => {
  try {
    const { planId } = req.params;
    const { zoneIds, allZonesIncluded } = req.body;

    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    const plan = await AvailableService.findById(planId);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Update allZonesIncluded flag if provided
    if (typeof allZonesIncluded === 'boolean') {
      plan.allZonesIncluded = allZonesIncluded;
      await plan.save();
    }

    // If allZonesIncluded is true, clear specific zone assignments
    if (plan.allZonesIncluded) {
      await PlanZone.deleteMany({ planId });
      return res.json({
        planId,
        planName: plan.name,
        allZonesIncluded: true,
        zones: []
      });
    }

    // Validate zone IDs
    if (!Array.isArray(zoneIds)) {
      return res.status(400).json({ error: 'zoneIds must be an array' });
    }

    const validZoneIds = zoneIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    const zones = await Zone.find({ _id: { $in: validZoneIds } });

    if (zones.length !== validZoneIds.length) {
      return res.status(400).json({ error: 'Some zone IDs are invalid' });
    }

    // Replace all plan zones
    await PlanZone.deleteMany({ planId });

    if (validZoneIds.length > 0) {
      const planZonesDocs = validZoneIds.map(zoneId => ({
        planId,
        zoneId
      }));
      await PlanZone.insertMany(planZonesDocs);
    }

    res.json({
      planId,
      planName: plan.name,
      allZonesIncluded: plan.allZonesIncluded,
      zones: zones.map(z => ({
        id: z._id,
        name: z.name,
        description: z.description
      }))
    });
  } catch (error) {
    console.error('Set plan zones error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 3: Commit**

```bash
git add src/controllers/adminController.js
git commit -m "feat(admin): add plan zone management endpoints"
```

---

### Task 14: Add admin routes for zone management

**Files:**
- Modify: `src/routes/adminRoutes.js`

- [ ] **Step 1: Add zone management routes**

```javascript
// Zone management
router.get('/zones', adminController.getZones);
router.post('/zones', adminController.createZone);
router.patch('/zones/:zoneId', adminController.updateZone);
router.delete('/zones/:zoneId', adminController.deleteZone);

// Country management within zones
router.post('/zones/:zoneId/countries', adminController.addCountryToZone);
router.delete('/zones/:zoneId/countries/:countryId', adminController.removeCountryFromZone);

// Plan zone management
router.get('/plans/:planId/zones', adminController.getPlanZones);
router.put('/plans/:planId/zones', adminController.setPlanZones);
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/adminRoutes.js
git commit -m "feat(routes): add admin routes for zone management"
```

---

## Chunk 6: Admin Addon Management

### Task 15: Add addon management endpoints

**Files:**
- Modify: `src/controllers/adminController.js`

- [ ] **Step 1: Add getAddons function**

```javascript
exports.getAddons = async (req, res) => {
  try {
    const addons = await Addon.find().sort({ type: 1, name: 1 }).lean();

    const formattedAddons = addons.map(a => ({
      id: a._id,
      name: a.name,
      type: a.type,
      priceINR: a.priceINR,
      priceUSD: a.priceUSD,
      zoneCount: a.zoneCount,
      jobCreditCount: a.jobCreditCount,
      unlockAllZones: a.unlockAllZones,
      createdAt: a.createdAt
    }));

    res.json({ addons: formattedAddons });
  } catch (error) {
    console.error('Get addons error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 2: Add createAddon function**

```javascript
exports.createAddon = async (req, res) => {
  try {
    const { name, type, priceINR, priceUSD, zoneCount, jobCreditCount, unlockAllZones } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }

    if (!['zone', 'jobs'].includes(type)) {
      return res.status(400).json({ error: 'Type must be zone or jobs' });
    }

    const existingAddon = await Addon.findOne({ name: name.trim() });
    if (existingAddon) {
      return res.status(409).json({ error: 'Addon with this name already exists' });
    }

    const addonData = {
      name: name.trim(),
      type,
      priceINR: priceINR || null,
      priceUSD: priceUSD || null
    };

    if (type === 'zone') {
      addonData.unlockAllZones = unlockAllZones || false;
      if (!unlockAllZones) {
        addonData.zoneCount = zoneCount;
      }
    } else if (type === 'jobs') {
      addonData.jobCreditCount = jobCreditCount;
    }

    const addon = await Addon.create(addonData);

    res.status(201).json({
      id: addon._id,
      name: addon.name,
      type: addon.type,
      priceINR: addon.priceINR,
      priceUSD: addon.priceUSD,
      zoneCount: addon.zoneCount,
      jobCreditCount: addon.jobCreditCount,
      unlockAllZones: addon.unlockAllZones
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Create addon error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 3: Add updateAddon function**

```javascript
exports.updateAddon = async (req, res) => {
  try {
    const { addonId } = req.params;
    const { name, priceINR, priceUSD, zoneCount, jobCreditCount, unlockAllZones } = req.body;

    if (!mongoose.Types.ObjectId.isValid(addonId)) {
      return res.status(400).json({ error: 'Invalid addon ID' });
    }

    const addon = await Addon.findById(addonId);
    if (!addon) {
      return res.status(404).json({ error: 'Addon not found' });
    }

    if (name !== undefined) {
      const existingAddon = await Addon.findOne({
        name: name.trim(),
        _id: { $ne: addonId }
      });
      if (existingAddon) {
        return res.status(409).json({ error: 'Addon with this name already exists' });
      }
      addon.name = name.trim();
    }

    if (priceINR !== undefined) addon.priceINR = priceINR;
    if (priceUSD !== undefined) addon.priceUSD = priceUSD;

    if (addon.type === 'zone') {
      if (unlockAllZones !== undefined) addon.unlockAllZones = unlockAllZones;
      if (zoneCount !== undefined && !addon.unlockAllZones) addon.zoneCount = zoneCount;
    } else if (addon.type === 'jobs') {
      if (jobCreditCount !== undefined) addon.jobCreditCount = jobCreditCount;
    }

    await addon.save();

    res.json({
      id: addon._id,
      name: addon.name,
      type: addon.type,
      priceINR: addon.priceINR,
      priceUSD: addon.priceUSD,
      zoneCount: addon.zoneCount,
      jobCreditCount: addon.jobCreditCount,
      unlockAllZones: addon.unlockAllZones
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Update addon error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 4: Add deleteAddon function**

```javascript
exports.deleteAddon = async (req, res) => {
  try {
    const { addonId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(addonId)) {
      return res.status(400).json({ error: 'Invalid addon ID' });
    }

    // Check if addon has been purchased
    const purchaseCount = await SubscriptionAddon.countDocuments({ addonId });
    if (purchaseCount > 0) {
      return res.status(400).json({
        error: 'Cannot delete addon that has been purchased',
        purchaseCount
      });
    }

    await Addon.findByIdAndDelete(addonId);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete addon error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 5: Add routes in adminRoutes.js**

```javascript
// Addon management
router.get('/addons', adminController.getAddons);
router.post('/addons', adminController.createAddon);
router.patch('/addons/:addonId', adminController.updateAddon);
router.delete('/addons/:addonId', adminController.deleteAddon);
```

- [ ] **Step 6: Commit**

```bash
git add src/controllers/adminController.js src/routes/adminRoutes.js
git commit -m "feat(admin): add addon CRUD endpoints"
```

---

## Chunk 7: Student Zone and Addon Endpoints

### Task 16: Add student zone endpoints

**Files:**
- Modify: `src/controllers/studentController.js`
- Modify: `src/routes/studentRoutes.js`

- [ ] **Step 1: Add getSubscriptionZones function**

```javascript
exports.getSubscriptionZones = async (req, res) => {
  try {
    const student = await Student.findOne({ userId: req.user.userId });
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const { getAccessibleZones } = require('../services/zoneAccessService');
    const access = await getAccessibleZones(student._id);

    if (access.allZones) {
      const Zone = require('../models/Zone');
      const allZones = await Zone.find().select('name description').lean();
      return res.json({
        allZonesIncluded: true,
        zones: allZones.map(z => ({ id: z._id, name: z.name, description: z.description }))
      });
    }

    const Zone = require('../models/Zone');
    const zones = await Zone.find({ _id: { $in: access.zoneIds } })
      .select('name description')
      .lean();

    res.json({
      allZonesIncluded: false,
      zones: zones.map(z => ({ id: z._id, name: z.name, description: z.description }))
    });
  } catch (error) {
    console.error('Get subscription zones error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 2: Add getZoneAddons function**

```javascript
exports.getZoneAddons = async (req, res) => {
  try {
    const Addon = require('../models/Addon');
    const addons = await Addon.find({ type: 'zone' })
      .select('name priceINR priceUSD zoneCount unlockAllZones')
      .sort({ priceINR: 1 })
      .lean();

    const formattedAddons = addons.map(a => ({
      id: a._id,
      name: a.name,
      priceINR: a.priceINR,
      priceUSD: a.priceUSD,
      zoneCount: a.zoneCount,
      unlockAllZones: a.unlockAllZones
    }));

    res.json({ addons: formattedAddons });
  } catch (error) {
    console.error('Get zone addons error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 3: Add routes**

```javascript
// Zone-related endpoints
router.get('/subscription/zones', requireAuth, requireUserType('student'), studentController.getSubscriptionZones);
router.get('/zone-addons', requireAuth, requireUserType('student'), studentController.getZoneAddons);
```

- [ ] **Step 4: Commit**

```bash
git add src/controllers/studentController.js src/routes/studentRoutes.js
git commit -m "feat(student): add zone access and addon listing endpoints"
```

---

## Chunk 8: Payment Integration for Zone Addons and Pay-Per-Job

### Task 17: Add zone addon purchase endpoint

**Files:**
- Modify: `src/controllers/paymentController.js`
- Modify: `src/routes/paymentRoutes.js`

- [ ] **Step 1: Add purchaseZoneAddon function**

```javascript
exports.purchaseZoneAddon = async (req, res) => {
  try {
    const { addonId, zoneIds } = req.body;

    const student = await Student.findOne({ userId: req.user.userId });
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    if (!student.currentSubscriptionId) {
      return res.status(400).json({ error: 'No active subscription' });
    }

    const addon = await Addon.findById(addonId);
    if (!addon || addon.type !== 'zone') {
      return res.status(400).json({ error: 'Invalid zone addon' });
    }

    // Validate zone selection for non-unlockAllZones addons
    if (!addon.unlockAllZones) {
      if (!Array.isArray(zoneIds) || zoneIds.length !== addon.zoneCount) {
        return res.status(400).json({
          error: `Must select exactly ${addon.zoneCount} zone(s)`
        });
      }

      // Check zones exist and aren't already accessible
      const { getAccessibleZones } = require('../services/zoneAccessService');
      const access = await getAccessibleZones(student._id);

      if (access.allZones) {
        return res.status(400).json({ error: 'You already have access to all zones' });
      }

      const Zone = require('../models/Zone');
      const zones = await Zone.find({ _id: { $in: zoneIds } });
      if (zones.length !== zoneIds.length) {
        return res.status(400).json({ error: 'Invalid zone ID(s)' });
      }

      const alreadyAccessible = zoneIds.filter(zId =>
        access.zoneIds.some(aId => aId.equals(zId))
      );
      if (alreadyAccessible.length > 0) {
        return res.status(400).json({ error: 'Some zones are already accessible' });
      }
    }

    // Determine currency and amount
    const currency = req.body.currency || 'INR';
    const amount = currency === 'INR' ? addon.priceINR : addon.priceUSD;

    if (!amount) {
      return res.status(400).json({ error: 'Addon price not configured for this currency' });
    }

    // Create Razorpay order
    const razorpay = require('../config/razorpay');
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency,
      notes: {
        type: 'zone_addon',
        studentId: student._id.toString(),
        addonId: addon._id.toString(),
        zoneIds: addon.unlockAllZones ? 'all' : JSON.stringify(zoneIds)
      }
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      addon: {
        id: addon._id,
        name: addon.name
      }
    });
  } catch (error) {
    console.error('Purchase zone addon error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 2: Add verifyZoneAddonPayment function**

```javascript
exports.verifyZoneAddonPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Verify signature
    const crypto = require('crypto');
    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    // Get order details
    const razorpay = require('../config/razorpay');
    const order = await razorpay.orders.fetch(razorpay_order_id);

    if (order.notes.type !== 'zone_addon') {
      return res.status(400).json({ error: 'Invalid order type' });
    }

    const studentId = order.notes.studentId;
    const addonId = order.notes.addonId;
    const zoneIdsStr = order.notes.zoneIds;

    const student = await Student.findById(studentId);
    const addon = await Addon.findById(addonId);

    // Create payment record
    const PaymentRecord = require('../models/PaymentRecord');
    const paymentRecord = await PaymentRecord.create({
      studentId,
      serviceId: null,
      subscriptionId: student.currentSubscriptionId,
      amount: order.amount / 100,
      currency: order.currency,
      paymentDate: new Date(),
      status: 'completed',
      transactionId: razorpay_payment_id,
      paymentMethod: 'razorpay',
      gatewayResponse: { orderId: razorpay_order_id }
    });

    // Create subscription addon
    const SubscriptionAddon = require('../models/SubscriptionAddon');
    await SubscriptionAddon.create({
      subscriptionId: student.currentSubscriptionId,
      addonId,
      paymentRecordId: paymentRecord._id,
      quantity: 1
    });

    // Create subscription zone entries (if not unlockAllZones)
    if (!addon.unlockAllZones && zoneIdsStr !== 'all') {
      const zoneIds = JSON.parse(zoneIdsStr);
      const SubscriptionZone = require('../models/SubscriptionZone');

      for (const zoneId of zoneIds) {
        await SubscriptionZone.findOneAndUpdate(
          { subscriptionId: student.currentSubscriptionId, zoneId },
          {
            $setOnInsert: {
              subscriptionId: student.currentSubscriptionId,
              zoneId,
              source: 'addon',
              createdAt: new Date()
            }
          },
          { upsert: true }
        );
      }
    }

    res.json({ success: true, paymentId: razorpay_payment_id });
  } catch (error) {
    console.error('Verify zone addon payment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 3: Add routes**

```javascript
router.post('/zone-addon/purchase', requireAuth, requireUserType('student'), paymentController.purchaseZoneAddon);
router.post('/zone-addon/verify', requireAuth, requireUserType('student'), paymentController.verifyZoneAddonPayment);
```

- [ ] **Step 4: Commit**

```bash
git add src/controllers/paymentController.js src/routes/paymentRoutes.js
git commit -m "feat(payment): add zone addon purchase and verification endpoints"
```

---

### Task 18: Add pay-per-job purchase endpoint

**Files:**
- Modify: `src/controllers/paymentController.js`
- Modify: `src/routes/paymentRoutes.js`

- [ ] **Step 1: Import PayPerJobPurchase model**

```javascript
const PayPerJobPurchase = require('../models/PayPerJobPurchase');
```

- [ ] **Step 2: Add initiatePayPerJob function**

```javascript
exports.initiatePayPerJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { currency = 'INR' } = req.body;

    const student = await Student.findOne({ userId: req.user.userId });
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const JobPosting = require('../models/JobPosting');
    const job = await JobPosting.findById(jobId);
    if (!job || job.status !== 'approved') {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Check if already purchased
    const existingPurchase = await PayPerJobPurchase.findOne({
      studentId: student._id,
      jobPostingId: jobId,
      status: 'completed'
    });
    if (existingPurchase) {
      return res.status(400).json({ error: 'You have already purchased access to this job' });
    }

    // Pricing as per spec
    const amount = currency === 'INR' ? 2500 : 35;

    // Create or update pending purchase
    let purchase = await PayPerJobPurchase.findOne({
      studentId: student._id,
      jobPostingId: jobId,
      status: { $in: ['pending', 'failed'] }
    });

    // Create Razorpay order
    const razorpay = require('../config/razorpay');
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency,
      notes: {
        type: 'pay_per_job',
        studentId: student._id.toString(),
        jobPostingId: jobId
      }
    });

    if (purchase) {
      purchase.amount = amount;
      purchase.currency = currency;
      purchase.razorpayOrderId = order.id;
      purchase.status = 'pending';
      await purchase.save();
    } else {
      purchase = await PayPerJobPurchase.create({
        studentId: student._id,
        jobPostingId: jobId,
        amount,
        currency,
        razorpayOrderId: order.id,
        status: 'pending'
      });
    }

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      purchaseId: purchase._id,
      job: {
        id: job._id,
        title: job.title
      }
    });
  } catch (error) {
    console.error('Initiate pay per job error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 3: Add verifyPayPerJob function**

```javascript
exports.verifyPayPerJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Verify signature
    const crypto = require('crypto');
    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const student = await Student.findOne({ userId: req.user.userId });
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Find and update purchase
    const purchase = await PayPerJobPurchase.findOne({
      studentId: student._id,
      jobPostingId: jobId,
      razorpayOrderId: razorpay_order_id
    });

    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    // Create payment record
    const PaymentRecord = require('../models/PaymentRecord');
    const paymentRecord = await PaymentRecord.create({
      studentId: student._id,
      serviceId: null,
      subscriptionId: null,
      amount: purchase.amount,
      currency: purchase.currency,
      paymentDate: new Date(),
      status: 'completed',
      transactionId: razorpay_payment_id,
      paymentMethod: 'razorpay',
      gatewayResponse: { orderId: razorpay_order_id, type: 'pay_per_job' }
    });

    // Update purchase status
    purchase.status = 'completed';
    purchase.completedAt = new Date();
    purchase.paymentRecordId = paymentRecord._id;
    await purchase.save();

    res.json({ success: true, paymentId: razorpay_payment_id });
  } catch (error) {
    console.error('Verify pay per job error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
```

- [ ] **Step 4: Add routes**

```javascript
router.post('/pay-per-job/:jobId', requireAuth, requireUserType('student'), paymentController.initiatePayPerJob);
router.post('/pay-per-job/:jobId/verify', requireAuth, requireUserType('student'), paymentController.verifyPayPerJob);
```

- [ ] **Step 5: Commit**

```bash
git add src/controllers/paymentController.js src/routes/paymentRoutes.js
git commit -m "feat(payment): add pay-per-job purchase and verification endpoints"
```

---

## Chunk 9: Migration and Feature Flag

### Task 19: Add feature flag support

**Files:**
- Modify: `src/services/zoneAccessService.js` (already done)
- Create: `.env.example` update

- [ ] **Step 1: Add ZONE_ENFORCEMENT_ENABLED to .env.example**

```bash
# Zone Pricing Feature
ZONE_ENFORCEMENT_ENABLED=false
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "feat(config): add ZONE_ENFORCEMENT_ENABLED feature flag"
```

---

### Task 20: Create migration script for existing subscriptions

**Files:**
- Create: `scripts/migrate-subscription-zones.js`

- [ ] **Step 1: Create migration script**

```javascript
/**
 * Migration script to populate SubscriptionZone for existing subscriptions.
 * Run with: node scripts/migrate-subscription-zones.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const ActiveSubscription = require('../src/models/ActiveSubscription');
  const PlanZone = require('../src/models/PlanZone');
  const SubscriptionZone = require('../src/models/SubscriptionZone');
  const AvailableService = require('../src/models/AvailableService');

  // Find all active subscriptions
  const subscriptions = await ActiveSubscription.find({ status: 'active' })
    .populate('serviceId', 'allZonesIncluded');

  console.log(`Found ${subscriptions.length} active subscriptions`);

  let migrated = 0;
  let skipped = 0;

  for (const sub of subscriptions) {
    // Skip if plan has allZonesIncluded
    if (sub.serviceId?.allZonesIncluded) {
      skipped++;
      continue;
    }

    // Get plan zones
    const planZones = await PlanZone.find({ planId: sub.serviceId._id });

    if (planZones.length === 0) {
      skipped++;
      continue;
    }

    // Create subscription zones
    for (const pz of planZones) {
      await SubscriptionZone.findOneAndUpdate(
        { subscriptionId: sub._id, zoneId: pz.zoneId },
        {
          $setOnInsert: {
            subscriptionId: sub._id,
            zoneId: pz.zoneId,
            source: 'plan',
            createdAt: new Date()
          }
        },
        { upsert: true }
      );
    }

    migrated++;
    console.log(`Migrated subscription ${sub._id}: ${planZones.length} zones`);
  }

  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add scripts/migrate-subscription-zones.js
git commit -m "feat(scripts): add migration script for subscription zones"
```

---

### Task 21: Update subscription creation to populate zones

**Files:**
- Modify: `src/controllers/subscriptionController.js`

- [ ] **Step 1: Import zonePricingService**

```javascript
const { ensureSubscriptionZonesForPlan } = require('../services/zonePricingService');
```

- [ ] **Step 2: Call ensureSubscriptionZonesForPlan after creating subscription**

After subscription creation in `activateSubscription` or similar function, add:

```javascript
    // Populate subscription zones from plan
    await ensureSubscriptionZonesForPlan({
      subscriptionId: subscription._id,
      serviceId: service._id
    });
```

- [ ] **Step 3: Commit**

```bash
git add src/controllers/subscriptionController.js
git commit -m "feat(subscription): auto-populate zones on subscription creation"
```

---

## Final Checklist

- [ ] All models updated (JobPosting, Addon, AvailableService, PayPerJobPurchase)
- [ ] Zone access service created with feature flag
- [ ] Student controller updated for zone locking
- [ ] Company controller updated for countryId
- [ ] Admin endpoints for zone and addon management
- [ ] Payment endpoints for zone addons and pay-per-job
- [ ] Migration script for existing subscriptions
- [ ] Feature flag documented in .env.example

---

## Testing Notes

1. **Manual Testing Priority:**
   - Create zones and assign countries via admin API
   - Assign zones to plans via admin API
   - Create a job with countryId
   - Test student job access with different subscription types
   - Test zone addon purchase flow
   - Test pay-per-job purchase flow

2. **Feature Flag Testing:**
   - With `ZONE_ENFORCEMENT_ENABLED=false`: all jobs accessible
   - With `ZONE_ENFORCEMENT_ENABLED=true`: zone checks enforced

3. **Edge Cases:**
   - Student with no subscription
   - Job without countryId (should be accessible)
   - Free tier student (all zones)
   - Student with unlockAllZones addon
