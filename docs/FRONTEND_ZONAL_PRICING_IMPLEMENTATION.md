# Frontend Implementation Guide: Zonal Pricing Feature

**Date:** 2026-03-18
**Backend Branch:** `feature/student-razorpay-payment`
**Feature Flag:** `ZONE_ENFORCEMENT_ENABLED` (backend env variable)

---

## Executive Summary

We've implemented zone-based geographic access control for job listings. Students' subscription plans include access to specific geographic zones. Jobs outside their zones show limited info with upgrade prompts.

**Key Concept:** Jobs are linked to countries, countries belong to zones, plans include specific zones.

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [API Reference](#2-api-reference)
3. [Student Portal Changes](#3-student-portal-changes)
4. [Company Portal Changes](#4-company-portal-changes)
5. [Admin Panel Changes](#5-admin-panel-changes)
6. [Payment Integration](#6-payment-integration)
7. [Edge Cases & Error Handling](#7-edge-cases--error-handling)
8. [UI/UX Guidelines](#8-uiux-guidelines)

---

## 1. Feature Overview

### Zone Structure

| Zone | Description | Example Countries |
|------|-------------|-------------------|
| Zone 1 | Premium Markets | USA, UK, Germany, Singapore, UAE |
| Zone 2 | Growing Markets | Canada, Japan, South Korea |
| Zone 3 | Emerging Markets | India, Brazil, Mexico, Vietnam |
| Zone 4 | Niche Markets | Norway, Denmark, Panama |

### Plan Zone Access

| Plan | Price | Applications | Zone Access |
|------|-------|--------------|-------------|
| Free | ₹0 | 2 | **All zones** (quota-limited) |
| Starter | ₹599/mo | 5 | 2 zones (admin-configured) |
| Pro | ₹1,699/mo | 10-15 | 3 zones (admin-configured) |
| Premium | ₹3,250/mo | Unlimited | **All zones** |

### Add-on Options

| Add-On | Price (INR) | Price (USD) | Description |
|--------|-------------|-------------|-------------|
| Single Extra Zone | ₹199 | $3 | Unlock 1 additional zone |
| 2-Zone Bundle | ₹349 | $5 | Unlock 2 additional zones |
| All Remaining Zones | ₹699 | $10 | Unlock all zones permanently |
| Pay Per Job | ₹2,500 | $35 | Access single job (bypasses subscription) |

---

## 2. API Reference

### 2.1 Student APIs

#### GET /student/jobs (Job Listing)

**Response changes:**
```json
{
  "jobs": [
    {
      "id": "job123",
      "title": "Senior Developer",
      "company": { "name": "TechCorp", "logo": "..." },
      "location": "New York, USA",
      "jobType": "Full-time",
      "salaryRange": "₹18,00,000 - ₹28,00,000",
      "deadline": "2026-04-15",
      "isZoneLocked": true,  // NEW FIELD
      "description": "...",  // Still shown in listing
      "requirements": "..."  // Still shown in listing
    }
  ],
  "pagination": { ... }
}
```

**Note:** `isZoneLocked` indicates if the student lacks zone access. Description/requirements are still shown in listings but locked in detail view.

---

#### GET /student/jobs/:jobId (Job Detail)

**When job is UNLOCKED:**
```json
{
  "id": "job123",
  "title": "Senior Developer",
  "description": "Full job description here...",
  "requirements": "5+ years experience...",
  "location": "New York, USA",
  "jobType": "Full-time",
  "salaryRange": "₹18,00,000 - ₹28,00,000",
  "company": { ... },
  "isDescriptionLocked": false,
  "isZoneLocked": false,
  "zoneLockReason": null,
  "hasApplied": false,
  "applicationStatus": null
}
```

**When job is ZONE LOCKED:**
```json
{
  "id": "job123",
  "title": "Senior Developer",
  "description": null,        // HIDDEN
  "requirements": null,       // HIDDEN
  "location": "New York, USA",
  "jobType": "Full-time",
  "salaryRange": "₹18,00,000 - ₹28,00,000",
  "company": { ... },
  "isDescriptionLocked": true,
  "isZoneLocked": true,
  "zoneLockReason": {
    "zone": {
      "id": "zone1_id",
      "name": "Zone 1 - Premium Markets"
    },
    "unlockOptions": [
      {
        "type": "zone-addon",
        "addonId": "addon123",
        "name": "Single Extra Zone",
        "priceINR": 199,
        "priceUSD": 3
      },
      {
        "type": "unlock-all-zones",
        "addonId": "addon456",
        "name": "All Remaining Zones",
        "priceINR": 699,
        "priceUSD": 10
      },
      {
        "type": "pay-per-job",
        "priceINR": 2500,
        "priceUSD": 35
      },
      {
        "type": "upgrade-plan",
        "url": "/pricing"
      }
    ]
  },
  "hasApplied": false,
  "applicationStatus": null
}
```

**When job is QUOTA LOCKED (not zone):**
```json
{
  "isDescriptionLocked": true,
  "isZoneLocked": false,
  "zoneLockReason": null
  // description and requirements are null
}
```

---

#### POST /student/jobs/:jobId/apply (Apply to Job)

**Success (201):**
```json
{
  "application": {
    "id": "app123",
    "status": "pending",
    "appliedAt": "2026-03-18T10:00:00Z"
  }
}
```

**Error - Zone Locked (403):**
```json
{
  "error": "This job is in a zone not included in your plan.",
  "isZoneLocked": true,
  "zoneLockReason": {
    "zone": { "id": "...", "name": "Zone 1 - Premium Markets" },
    "unlockOptions": [ ... ]  // Same structure as job detail
  }
}
```

**Error - Quota Exhausted (403):**
```json
{
  "error": "You have reached your application limit.",
  "applicationsUsed": 5,
  "maxApplications": 5
}
```

**Error - Already Applied (400):**
```json
{
  "error": "You have already applied to this job"
}
```

---

#### GET /student/subscription/zones (My Zones)

**Response:**
```json
{
  "allZonesIncluded": false,
  "zones": [
    { "id": "zone1", "name": "Zone 1 - Premium Markets", "description": "USA, UK, Germany..." },
    { "id": "zone3", "name": "Zone 3 - Emerging Markets", "description": "India, Brazil..." }
  ]
}
```

**When student has all zones:**
```json
{
  "allZonesIncluded": true,
  "zones": [
    // All zones listed
  ]
}
```

---

#### GET /student/zone-addons (Available Zone Add-ons)

**Response:**
```json
{
  "addons": [
    {
      "id": "addon1",
      "name": "Single Extra Zone",
      "priceINR": 199,
      "priceUSD": 3,
      "zoneCount": 1,
      "unlockAllZones": false
    },
    {
      "id": "addon2",
      "name": "2-Zone Bundle",
      "priceINR": 349,
      "priceUSD": 5,
      "zoneCount": 2,
      "unlockAllZones": false
    },
    {
      "id": "addon3",
      "name": "All Remaining Zones",
      "priceINR": 699,
      "priceUSD": 10,
      "zoneCount": null,
      "unlockAllZones": true
    }
  ]
}
```

---

### 2.2 Payment APIs

#### POST /payment/zone-addon/purchase (Initiate Zone Addon Purchase)

**Request:**
```json
{
  "addonId": "addon123",
  "zoneIds": ["zone2_id", "zone4_id"],  // Required for specific zone addons
  "currency": "INR"  // or "USD"
}
```

**Note:** `zoneIds` is required for single/bundle zone addons, ignored for `unlockAllZones` addons.

**Success Response:**
```json
{
  "orderId": "order_razorpay123",
  "amount": 34900,  // In paise (₹349)
  "currency": "INR",
  "addon": {
    "id": "addon123",
    "name": "2-Zone Bundle"
  }
}
```

**Error - Already Have Access (400):**
```json
{
  "error": "Some zones are already accessible"
}
```

**Error - Wrong Zone Count (400):**
```json
{
  "error": "Must select exactly 2 zone(s)"
}
```

---

#### POST /payment/zone-addon/verify (Verify Zone Addon Payment)

**Request:**
```json
{
  "razorpay_order_id": "order_razorpay123",
  "razorpay_payment_id": "pay_razorpay456",
  "razorpay_signature": "signature_hash"
}
```

**Success Response:**
```json
{
  "success": true,
  "paymentId": "pay_razorpay456"
}
```

---

#### POST /payment/pay-per-job/:jobId (Initiate Pay-Per-Job)

**Request:**
```json
{
  "currency": "INR"  // or "USD"
}
```

**Success Response:**
```json
{
  "orderId": "order_razorpay789",
  "amount": 250000,  // In paise (₹2500)
  "currency": "INR",
  "purchaseId": "purchase123",
  "job": {
    "id": "job123",
    "title": "Senior Developer"
  }
}
```

**Error - Already Purchased (400):**
```json
{
  "error": "You have already purchased access to this job"
}
```

---

#### POST /payment/pay-per-job/:jobId/verify (Verify Pay-Per-Job)

**Request:**
```json
{
  "razorpay_order_id": "order_razorpay789",
  "razorpay_payment_id": "pay_razorpay012",
  "razorpay_signature": "signature_hash"
}
```

**Success Response:**
```json
{
  "success": true,
  "paymentId": "pay_razorpay012"
}
```

---

### 2.3 Company APIs

#### GET /company/countries (Countries Dropdown)

**Response:**
```json
{
  "countries": [
    {
      "id": "country1",
      "name": "United States",
      "zone": { "id": "zone1", "name": "Zone 1 - Premium Markets" }
    },
    {
      "id": "country2",
      "name": "India",
      "zone": { "id": "zone3", "name": "Zone 3 - Emerging Markets" }
    }
  ]
}
```

---

#### POST /company/jobs (Create Job - Updated)

**Request (with new countryId field):**
```json
{
  "title": "Senior Developer",
  "description": "...",
  "requirements": "...",
  "location": "Bangalore, Karnataka",  // Free text for specific location
  "countryId": "country2",             // NEW - Links to zone
  "jobType": "Full-time",
  "salaryRange": "₹18,00,000 - ₹28,00,000",
  "deadline": "2026-04-15"
}
```

---

#### PATCH /company/jobs/:jobId (Update Job - Updated)

**Request (can update countryId):**
```json
{
  "countryId": "country1"  // Can be null to remove zone restriction
}
```

---

### 2.4 Admin APIs

#### Zone Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/zones` | List all zones with countries |
| POST | `/admin/zones` | Create zone |
| PATCH | `/admin/zones/:zoneId` | Update zone |
| DELETE | `/admin/zones/:zoneId` | Delete zone |
| POST | `/admin/zones/:zoneId/countries` | Add country to zone |
| DELETE | `/admin/zones/:zoneId/countries/:countryId` | Remove country |

#### GET /admin/zones Response:
```json
{
  "zones": [
    {
      "id": "zone1",
      "name": "Zone 1 - Premium Markets",
      "description": "Corporate hubs and premium job markets",
      "countries": [
        { "id": "c1", "name": "United States" },
        { "id": "c2", "name": "United Kingdom" }
      ],
      "countryCount": 5
    }
  ]
}
```

#### POST /admin/zones Request:
```json
{
  "name": "Zone 5 - New Markets",
  "description": "Newly added markets"
}
```

#### POST /admin/zones/:zoneId/countries Request:
```json
{
  "countryName": "Australia"
}
```

---

#### Plan Zone Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/plans/:planId/zones` | Get zones for plan |
| PUT | `/admin/plans/:planId/zones` | Set zones for plan |

#### GET /admin/plans/:planId/zones Response:
```json
{
  "planId": "plan123",
  "planName": "Starter",
  "allZonesIncluded": false,
  "zones": [
    { "id": "zone1", "name": "Zone 1", "description": "..." },
    { "id": "zone3", "name": "Zone 3", "description": "..." }
  ]
}
```

#### PUT /admin/plans/:planId/zones Request:
```json
{
  "zoneIds": ["zone1", "zone2", "zone3"],
  "allZonesIncluded": false
}
```

**To grant all zones:**
```json
{
  "allZonesIncluded": true
}
```

---

#### Addon Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/addons` | List all addons |
| POST | `/admin/addons` | Create addon |
| PATCH | `/admin/addons/:addonId` | Update addon |
| DELETE | `/admin/addons/:addonId` | Delete addon |

#### POST /admin/addons Request (Zone Addon):
```json
{
  "name": "Single Extra Zone",
  "type": "zone",
  "priceINR": 199,
  "priceUSD": 3,
  "zoneCount": 1,
  "unlockAllZones": false
}
```

#### POST /admin/addons Request (Unlock All Zones):
```json
{
  "name": "All Remaining Zones",
  "type": "zone",
  "priceINR": 699,
  "priceUSD": 10,
  "unlockAllZones": true
}
```

#### POST /admin/addons Request (Job Credits):
```json
{
  "name": "Extra 5 Applications",
  "type": "jobs",
  "priceINR": 149,
  "priceUSD": 2,
  "jobCreditCount": 5
}
```

---

## 3. Student Portal Changes

### 3.1 Job Listing Page

**Visual Changes:**
- Add lock icon overlay on zone-locked job cards
- Show subtle badge: "Zone Locked" or "Unlock to Apply"
- Keep all basic info visible (title, company, location, salary, type)
- Optional: Slightly fade locked job cards

**Implementation:**
```jsx
// Pseudo-code
{jobs.map(job => (
  <JobCard
    key={job.id}
    {...job}
    isLocked={job.isZoneLocked}
    lockBadge={job.isZoneLocked ? "Zone Locked" : null}
  />
))}
```

---

### 3.2 Job Detail Page

**When Zone Locked - Show Upgrade Panel:**

```
┌─────────────────────────────────────────────────────┐
│  🔒 This job is in Zone 1 - Premium Markets         │
│                                                      │
│  Your current plan doesn't include this zone.       │
│  Unlock access to view full details and apply.      │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │ 💳 Pay ₹2,500 for this job only             │    │
│  │    One-time access to view & apply          │    │
│  │                           [Pay Now]          │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │ 🌍 Add Zone 1 to your plan - ₹199           │    │
│  │    Access all jobs in this zone             │    │
│  │                           [Add Zone]         │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │ 🌐 Unlock All Zones - ₹699                  │    │
│  │    Access jobs in all current & future zones│    │
│  │                           [Unlock All]       │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │ ⬆️ Upgrade Your Plan                         │    │
│  │    Get more zones & applications            │    │
│  │                           [View Plans]       │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

**What to show when locked:**
- Job title, company, location, job type, salary range
- Company logo and basic info
- "Description" and "Requirements" sections with lock overlay

**What to hide when locked:**
- Full description text
- Full requirements text

---

### 3.3 Subscription/Account Page - New "Your Zones" Section

```
┌─────────────────────────────────────────────────────┐
│  Your Geographic Zones                              │
│                                                      │
│  Your plan includes access to:                      │
│                                                      │
│  ✅ Zone 1 - Premium Markets                        │
│     USA, UK, Germany, Singapore, UAE                │
│                                                      │
│  ✅ Zone 3 - Emerging Markets                       │
│     India, Brazil, Mexico, Vietnam, Indonesia       │
│                                                      │
│  ─────────────────────────────────────────────      │
│                                                      │
│  🔒 Zones not in your plan:                         │
│                                                      │
│  Zone 2 - Growing Markets          [Add - ₹199]    │
│  Zone 4 - Niche Markets            [Add - ₹199]    │
│                                                      │
│  Or unlock all zones for ₹699      [Unlock All]    │
└─────────────────────────────────────────────────────┘
```

---

### 3.4 Pricing Page Updates

Show zone information for each plan:

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│     STARTER     │  │       PRO       │  │     PREMIUM     │
│    ₹599/mo      │  │    ₹1,699/mo    │  │    ₹3,250/mo    │
│                 │  │                 │  │                 │
│ • 5 Applications│  │ • 15 Applications│ │ • Unlimited     │
│ • 2 Zones       │  │ • 3 Zones       │  │ • ALL Zones     │
│   - Zone 1      │  │   - Zone 1      │  │                 │
│   - Zone 3      │  │   - Zone 2      │  │                 │
│                 │  │   - Zone 3      │  │                 │
│                 │  │                 │  │                 │
│  [Choose Plan]  │  │  [Choose Plan]  │  │  [Choose Plan]  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 4. Company Portal Changes

### 4.1 Job Posting Form - Add Country Dropdown

**New Field:** Country (required when zone enforcement is enabled)

```
┌─────────────────────────────────────────────────────┐
│  Create Job Posting                                 │
│                                                      │
│  Job Title *                                        │
│  ┌─────────────────────────────────────────────┐    │
│  │ Senior Software Engineer                     │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  Country *                          ← NEW FIELD     │
│  ┌─────────────────────────────────────────────┐    │
│  │ ▼ Select Country                             │    │
│  │   ──────────────────────────────────────     │    │
│  │   Zone 1 - Premium Markets                   │    │
│  │     United States                            │    │
│  │     United Kingdom                           │    │
│  │     Germany                                  │    │
│  │     Singapore                                │    │
│  │   ──────────────────────────────────────     │    │
│  │   Zone 3 - Emerging Markets                  │    │
│  │     India                                    │    │
│  │     Brazil                                   │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  Location (Office Address) *                        │
│  ┌─────────────────────────────────────────────┐    │
│  │ Bangalore, Karnataka                         │    │
│  └─────────────────────────────────────────────┘    │
│  ℹ️ Specific office location for the job            │
│                                                      │
│  ... rest of form ...                               │
└─────────────────────────────────────────────────────┘
```

**Dropdown grouping:** Group countries by zone for easier selection.

**Fetch countries:** Call `GET /company/countries` on form load.

---

### 4.2 Edit Job - Allow Country Change

Allow companies to update the country for existing jobs.

---

## 5. Admin Panel Changes

### 5.1 Zone Management Page (New)

```
┌─────────────────────────────────────────────────────┐
│  Zone Management                    [+ Create Zone] │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │ Zone 1 - Premium Markets              [Edit] │    │
│  │ Corporate hubs and premium markets           │    │
│  │                                              │    │
│  │ Countries (5):                               │    │
│  │ ┌──────────────────────────────────────────┐│    │
│  ││ United States                    [Remove] ││    │
│  ││ United Kingdom                   [Remove] ││    │
│  ││ Germany                          [Remove] ││    │
│  ││ Singapore                        [Remove] ││    │
│  ││ UAE                              [Remove] ││    │
│  │└──────────────────────────────────────────┘│    │
│  │                                              │    │
│  │ [+ Add Country]                              │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │ Zone 2 - Growing Markets              [Edit] │    │
│  │ ...                                          │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

**Delete Zone Restrictions:**
- Cannot delete zone if assigned to any plan
- Cannot delete zone if any country has jobs assigned
- Show error with counts if deletion blocked

---

### 5.2 Plan Management - Zone Assignment

Add zone selection to plan edit page:

```
┌─────────────────────────────────────────────────────┐
│  Edit Plan: Starter                                 │
│                                                      │
│  ... existing fields ...                            │
│                                                      │
│  Zone Access                                        │
│                                                      │
│  ○ All Zones Included                               │
│  ● Specific Zones:                                  │
│                                                      │
│    ☑ Zone 1 - Premium Markets                       │
│    ☐ Zone 2 - Growing Markets                       │
│    ☑ Zone 3 - Emerging Markets                      │
│    ☐ Zone 4 - Niche Markets                         │
│                                                      │
│  [Save Changes]                                     │
└─────────────────────────────────────────────────────┘
```

---

### 5.3 Addon Management Page (New)

```
┌─────────────────────────────────────────────────────┐
│  Add-on Management                  [+ Create Addon]│
│                                                      │
│  Zone Add-ons                                       │
│  ┌─────────────────────────────────────────────┐    │
│  │ Single Extra Zone                            │    │
│  │ Type: zone | Zones: 1 | ₹199 / $3     [Edit]│    │
│  └─────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────┐    │
│  │ All Remaining Zones                          │    │
│  │ Type: zone | Unlock All | ₹699 / $10  [Edit]│    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  Job Credit Add-ons                                 │
│  ┌─────────────────────────────────────────────┐    │
│  │ Extra 5 Applications                         │    │
│  │ Type: jobs | Credits: 5 | ₹149 / $2   [Edit]│    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

---

## 6. Payment Integration

### 6.1 Zone Addon Purchase Flow

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND                         │
└───────────────────────┬─────────────────────────────┘
                        │
    1. User clicks "Add Zone" or "Unlock All"
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  If single/bundle addon:                            │
│  - Show zone selection modal                        │
│  - User selects exact number of zones               │
│  - Validate zones not already accessible            │
└───────────────────────┬─────────────────────────────┘
                        │
    2. POST /payment/zone-addon/purchase
       { addonId, zoneIds, currency }
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  Receive Razorpay order details                     │
│  { orderId, amount, currency }                      │
└───────────────────────┬─────────────────────────────┘
                        │
    3. Open Razorpay checkout modal
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  User completes payment                             │
│  Razorpay returns: order_id, payment_id, signature  │
└───────────────────────┬─────────────────────────────┘
                        │
    4. POST /payment/zone-addon/verify
       { razorpay_order_id, razorpay_payment_id,
         razorpay_signature }
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  On success:                                        │
│  - Show success message                             │
│  - Refresh user's zone access                       │
│  - Redirect back to job or refresh page             │
└─────────────────────────────────────────────────────┘
```

### 6.2 Pay-Per-Job Purchase Flow

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND                         │
└───────────────────────┬─────────────────────────────┘
                        │
    1. User clicks "Pay ₹2,500 for this job"
                        │
                        ▼
    2. POST /payment/pay-per-job/:jobId
       { currency: "INR" }
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  Receive Razorpay order details                     │
│  { orderId, amount, currency, job }                 │
└───────────────────────┬─────────────────────────────┘
                        │
    3. Open Razorpay checkout modal
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  User completes payment                             │
│  Razorpay returns: order_id, payment_id, signature  │
└───────────────────────┬─────────────────────────────┘
                        │
    4. POST /payment/pay-per-job/:jobId/verify
       { razorpay_order_id, razorpay_payment_id,
         razorpay_signature }
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  On success:                                        │
│  - Show success message                             │
│  - Refresh job detail page                          │
│  - Job should now be unlocked                       │
└─────────────────────────────────────────────────────┘
```

### 6.3 Razorpay Checkout Integration

```javascript
// Example Razorpay checkout options
const options = {
  key: RAZORPAY_KEY_ID,
  amount: response.amount,  // In paise
  currency: response.currency,
  name: "Aqua Talent",
  description: "Zone Addon Purchase",  // or "Pay Per Job - {jobTitle}"
  order_id: response.orderId,
  handler: async function (razorpayResponse) {
    // Verify payment
    await verifyPayment({
      razorpay_order_id: razorpayResponse.razorpay_order_id,
      razorpay_payment_id: razorpayResponse.razorpay_payment_id,
      razorpay_signature: razorpayResponse.razorpay_signature
    });
  },
  prefill: {
    name: user.name,
    email: user.email
  },
  theme: {
    color: "#3399cc"
  }
};

const razorpay = new Razorpay(options);
razorpay.open();
```

---

## 7. Edge Cases & Error Handling

### 7.1 Job Access Edge Cases

| Scenario | Behavior |
|----------|----------|
| Job has no countryId | Always accessible (no zone restriction) |
| Student has no subscription | Only sees jobs without zone restriction |
| Free tier student | Access to all zones (limited by 2-app quota) |
| Premium student | Access to all zones (unlimited apps) |
| Zone enforcement disabled | All jobs accessible (feature flag off) |
| Pay-per-job purchased | Job unlocked regardless of zone |

### 7.2 Zone Addon Purchase Edge Cases

| Scenario | Error Message |
|----------|---------------|
| Student already has all zones | "You already have access to all zones" |
| Selected zone already accessible | "Some zones are already accessible" |
| Wrong number of zones selected | "Must select exactly {n} zone(s)" |
| Invalid zone ID | "Invalid zone ID(s)" |
| No active subscription | "No active subscription" |

### 7.3 Pay-Per-Job Edge Cases

| Scenario | Behavior |
|----------|----------|
| Already purchased this job | Error: "You have already purchased access to this job" |
| Job not found | Error: "Job not found" (404) |
| Job not approved | Error: "Job not found" (treat as not found) |
| Payment fails | Purchase record stays pending, can retry |
| Payment succeeds | Job unlocked, does NOT consume application quota |

### 7.4 Apply to Job Error Priority

When a student tries to apply, check in this order:

1. **Already applied** → 400 "Already applied"
2. **Zone locked** → 403 with `isZoneLocked: true` and unlock options
3. **Quota exhausted** → 403 with quota info

Show the first applicable error.

---

## 8. UI/UX Guidelines

### 8.1 Lock Indicators

**Job Card (Listing):**
- Subtle lock icon in corner
- Optional: slight opacity reduction (0.8)
- Badge: "Zone Locked" or zone name

**Job Detail (Locked):**
- Full-width banner explaining the lock
- Clear upgrade options with prices
- Blurred/hidden content for description/requirements

### 8.2 Zone Selection Modal

When purchasing a zone addon that requires selection:

```
┌─────────────────────────────────────────────────────┐
│  Select 2 Zones to Unlock                     [X]  │
│                                                      │
│  Choose zones you want to add to your plan:         │
│                                                      │
│  ☐ Zone 2 - Growing Markets                         │
│     Canada, Japan, South Korea                      │
│                                                      │
│  ☐ Zone 4 - Niche Markets                           │
│     Norway, Denmark, Panama                         │
│                                                      │
│  ⚠️ You already have access to Zone 1 and Zone 3    │
│                                                      │
│  Selected: 0/2                                      │
│                                                      │
│  [Cancel]                    [Continue - ₹349]      │
└─────────────────────────────────────────────────────┘
```

### 8.3 Success States

After successful purchase:
- Show success toast/modal
- Auto-refresh the page or affected component
- For pay-per-job: redirect to now-unlocked job detail

### 8.4 Loading States

- Show loading during zone access check
- Show loading during payment processing
- Disable buttons during async operations

### 8.5 Currency Display

- Default to INR for Indian users
- Show USD alternative where appropriate
- Format: "₹199" or "$3"

---

## Quick Reference: New API Endpoints Summary

### Student Endpoints
```
GET  /student/jobs                      # Returns isZoneLocked per job
GET  /student/jobs/:jobId               # Returns zoneLockReason if locked
POST /student/jobs/:jobId/apply         # Returns zone error if locked
GET  /student/subscription/zones        # List accessible zones
GET  /student/zone-addons               # List purchasable zone addons
```

### Payment Endpoints
```
POST /payment/zone-addon/purchase       # Initiate zone addon purchase
POST /payment/zone-addon/verify         # Verify zone addon payment
POST /payment/pay-per-job/:jobId        # Initiate pay-per-job
POST /payment/pay-per-job/:jobId/verify # Verify pay-per-job payment
```

### Company Endpoints
```
GET  /company/countries                 # List countries for dropdown
POST /company/jobs                      # Now accepts countryId
PATCH /company/jobs/:jobId              # Now accepts countryId
```

### Admin Endpoints
```
GET    /admin/zones                     # List all zones
POST   /admin/zones                     # Create zone
PATCH  /admin/zones/:zoneId             # Update zone
DELETE /admin/zones/:zoneId             # Delete zone
POST   /admin/zones/:zoneId/countries   # Add country
DELETE /admin/zones/:zoneId/countries/:countryId  # Remove country
GET    /admin/plans/:planId/zones       # Get plan zones
PUT    /admin/plans/:planId/zones       # Set plan zones
GET    /admin/addons                    # List addons
POST   /admin/addons                    # Create addon
PATCH  /admin/addons/:addonId           # Update addon
DELETE /admin/addons/:addonId           # Delete addon
```

---

## Implementation Checklist

### Student Portal
- [ ] Update job listing to show `isZoneLocked` indicator
- [ ] Update job detail to show zone lock panel with unlock options
- [ ] Implement pay-per-job purchase flow
- [ ] Implement zone addon purchase flow with zone selection
- [ ] Add "Your Zones" section to subscription/account page
- [ ] Update pricing page to show zone info per plan

### Company Portal
- [ ] Add country dropdown to job posting form
- [ ] Implement country selection with zone grouping
- [ ] Allow country update on existing jobs

### Admin Panel
- [ ] Create zone management page (CRUD)
- [ ] Create country management within zones
- [ ] Add zone assignment to plan edit page
- [ ] Create addon management page (CRUD)

### Payment Integration
- [ ] Integrate Razorpay for zone addon purchase
- [ ] Integrate Razorpay for pay-per-job purchase
- [ ] Handle payment success/failure states
- [ ] Implement payment verification

---

## Questions?

If you have questions about specific API responses or behaviors, refer to:
- Backend spec: `docs/superpowers/specs/2026-03-18-zonal-pricing-design.md`
- Backend plan: `docs/superpowers/plans/2026-03-18-zonal-pricing.md`

Or test the APIs directly against the backend running on the `feature/student-razorpay-payment` branch.
