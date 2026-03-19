# Frontend Implementation: Zonal Pricing v2

## Overview

This document outlines the frontend implementation requirements for the updated zonal pricing system. The backend has been updated with new plans, zones, add-ons, and subscription behavior rules.

---

## 1. Subscription Plans

### Plan Structure

| Plan | INR Price | USD Price | Job Applications | Zones Included | Badge |
|------|-----------|-----------|------------------|----------------|-------|
| Free Tier | 0 | 0 | 2 (lifetime) | All (view only) | - |
| Starter | 599 | 17 | 5 | Zone 1, Zone 2 | - |
| Pro | 1,699 | 32 | 10-15 | Zone 1, Zone 2, Zone 3 | Most Popular |
| Premium | 3,250 | 55 | Unlimited | All Zones | Best Value |

### Display Requirements

1. **Pricing Page** (`/pricing` or `/plans`)
   - Show all 4 plans in a comparison grid
   - Display INR prices for Indian users, USD for international
   - Use geo-location API: `GET /api/payments/geo-location`
   - Highlight "Most Popular" badge on Pro plan
   - Show "Best Value" badge on Premium plan
   - Display zone count for each plan (2, 3, All)
   - Show application limits clearly

2. **Current Subscription Display**
   - Show remaining applications: `applicationLimit - applicationsUsed`
   - Show accessible zones list
   - Show any stacked applications from previous plan
   - Endpoint: `GET /api/subscriptions/current`

---

## 2. Zones

### Zone Structure

| Zone | Description | Countries |
|------|-------------|-----------|
| Zone 1 | Premium Shipping / Corporate Hubs | USA, UK, Germany, Singapore, UAE |
| Zone 2 | Growing Markets | Canada, Japan, South Korea |
| Zone 3 | Emerging Markets | India, Brazil, Mexico, Vietnam, Indonesia |
| Zone 4 | Niche / Optional Markets | Norway, Denmark, Panama |

### Display Requirements

1. **Zone Indicator on Jobs**
   - Each job has a `countryId` that maps to a zone
   - Show zone badge on job cards (e.g., "Zone 1" or country flag)
   - Visually indicate if job is in an accessible zone

2. **Zone Access UI**
   - Show which zones the student can access
   - For locked zones, show upgrade/addon options
   - Premium users see "All Zones" indicator

3. **Job Filtering**
   - Allow filtering jobs by zone
   - Show count of jobs per zone
   - Indicate which zones are accessible vs locked

---

## 3. Add-Ons

### Zone Add-Ons

| Add-On | INR Price | USD Price | Effect |
|--------|-----------|-----------|--------|
| Single Extra Zone | 199 | 3 | Unlock 1 additional zone |
| 2-Zone Bundle | 349 | 5 | Unlock 2 additional zones |
| All Remaining Zones | 699 | 10 | Unlock all zones not in plan |

### Job Credit Add-Ons

| Add-On | INR Price | USD Price | Effect |
|--------|-----------|-----------|--------|
| Extra Job Credits (3 Jobs) | 99 | 1 | Add 3 job applications |
| Extra Job Credits (5 Jobs) | 149 | 2 | Add 5 job applications |

### Pay Per Job

- Fixed price: **2,500 INR** / **35 USD**
- Allows applying to a single job outside quota

### Display Requirements

1. **Add-On Purchase Flow**
   - Show available add-ons based on current plan
   - For zone add-ons: show zone selector for non-"All Remaining" add-ons
   - Validate zone selection (cannot select already accessible zones)
   - Endpoints:
     - `POST /api/payments/zone-addon` - Create zone addon order
     - `POST /api/payments/zone-addon/verify` - Verify payment

2. **Job Credits Purchase**
   - Show when approaching application limit
   - Display current usage: "X of Y applications used"
   - Endpoint: Use subscription addon purchase flow

3. **Pay Per Job**
   - Show on individual job page when:
     - User has exhausted quota, OR
     - Job is in an inaccessible zone
   - Endpoints:
     - `POST /api/payments/pay-per-job/:jobId` - Initiate purchase
     - `POST /api/payments/pay-per-job/:jobId/verify` - Verify payment

---

## 4. Subscription Purchase Behavior

### Critical Business Rules

These rules are enforced by the backend. The frontend should reflect them in the UI:

#### Rule 1: Same Plan Purchase - BLOCKED

**Backend behavior**: If a student tries to buy the same plan they currently have with remaining applications, the request is rejected.

**Frontend implementation**:
- Check current subscription before showing purchase button
- If `currentPlan.id === selectedPlan.id && applicationsRemaining > 0`:
  - Disable/hide the purchase button for that plan
  - Show message: "You already have this plan with X applications remaining"
  - Suggest upgrading to a higher plan instead

**Error code**: `SAME_PLAN_ACTIVE`

#### Rule 2: Application Quota Stacking

**Backend behavior**: When upgrading/downgrading, remaining applications from old plan are added to new plan's quota.

**Frontend implementation**:
- Before purchase, show preview:
  ```
  Current Plan: Starter (3 of 5 used, 2 remaining)
  New Plan: Pro (15 applications)

  After upgrade: 15 + 2 = 17 total applications
  ```
- After purchase, `GET /api/subscriptions/current` will return the new combined limit

#### Rule 3: Zone Handling on Plan Change

**Backend behavior**:
- New plan's zones replace old plan's zones
- Addon-purchased zones are preserved
- Plan-included zones not in new plan are lost

**Frontend implementation**:
- Before downgrade, show warning:
  ```
  Warning: Downgrading from Pro to Starter

  You will lose access to:
  - Zone 3 (Emerging Markets)

  Jobs you've saved in Zone 3 will become inaccessible.

  Note: Any zones purchased as add-ons will be preserved.
  ```
- Show confirmation dialog before proceeding

#### Rule 4: Downgrade Allowed

**Backend behavior**: Downgrades are allowed without blocking. User loses plan-included zones.

**Frontend implementation**:
- Allow downgrade with warning (see Rule 3)
- Do NOT block the action, just inform the user

#### Rule 5: Free to Paid - Always Allowed

**Backend behavior**: Students can upgrade from free tier anytime, even with remaining free applications. Remaining apps are stacked.

**Frontend implementation**:
- Always show upgrade options to free tier users
- Show stacking preview if they have remaining free applications

---

## 5. API Endpoints Reference

### Subscription Endpoints

```
GET  /api/subscriptions/services     - List all available plans
GET  /api/subscriptions/current      - Get current subscription status
POST /api/subscriptions              - Create/upgrade subscription (manual)
PUT  /api/subscriptions              - Update subscription settings
DELETE /api/subscriptions            - Cancel subscription
GET  /api/subscriptions/payments     - Get payment history
```

### Payment Endpoints

```
GET  /api/payments/geo-location      - Get user's geo location for currency
POST /api/payments/create-order      - Create Razorpay order for plan purchase
POST /api/payments/verify            - Verify Razorpay payment

POST /api/payments/zone-addon        - Create zone addon order
POST /api/payments/zone-addon/verify - Verify zone addon payment

POST /api/payments/pay-per-job/:jobId        - Initiate pay-per-job
POST /api/payments/pay-per-job/:jobId/verify - Verify pay-per-job payment
```

### Zone Access Endpoint

```
GET /api/zones/access                - Get student's accessible zones
```

---

## 6. Response Schemas

### GET /api/subscriptions/current

```json
{
  "subscriptionTier": "paid",
  "status": "active",
  "isActive": true,
  "inGracePeriod": false,
  "currentSubscription": {
    "id": "...",
    "service": {
      "_id": "...",
      "name": "Pro",
      "maxApplications": 15,
      "price": 1699,
      "features": [...]
    },
    "startDate": "2026-03-19T...",
    "endDate": null,
    "status": "active",
    "autoRenew": false
  },
  "applicationLimit": 17,        // Includes stacked + addon credits
  "applicationsUsed": 3,
  "applicationsRemaining": 14
}
```

### GET /api/subscriptions/services

```json
{
  "services": [
    {
      "_id": "...",
      "name": "Free Tier",
      "tier": "free",
      "description": "...",
      "maxApplications": 2,
      "price": 0,
      "priceINR": 0,
      "priceUSD": 0,
      "features": [...],
      "displayOrder": 0,
      "allZonesIncluded": true
    },
    {
      "_id": "...",
      "name": "Starter",
      "tier": "paid",
      "maxApplications": 5,
      "priceINR": 599,
      "priceUSD": 17,
      "features": [...],
      "badge": null,
      "displayOrder": 1,
      "allZonesIncluded": false
    },
    // ... Pro, Premium
  ]
}
```

### Error Response for Same Plan Purchase

```json
{
  "error": "You already have an active subscription to this plan with remaining applications. Please use your current quota or upgrade to a different plan.",
  "code": "SAME_PLAN_ACTIVE"
}
```

---

## 7. UI Components to Build/Update

### New Components

1. **PlanComparisonGrid** - Display all plans with features comparison
2. **ZoneBadge** - Show zone indicator on job cards
3. **ZoneAccessPanel** - Show accessible vs locked zones
4. **AddonPurchaseModal** - Purchase zone/job add-ons
5. **SubscriptionUpgradePreview** - Show quota stacking preview
6. **DowngradeWarningModal** - Warn about zone loss on downgrade
7. **PayPerJobButton** - One-click job purchase

### Updated Components

1. **JobCard** - Add zone indicator, locked state
2. **JobFilters** - Add zone filter
3. **SubscriptionStatus** - Show stacked apps, addon credits
4. **PricingPage** - New plan structure, geo-based pricing

---

## 8. Testing Checklist

### Plan Purchase Flow

- [ ] Free tier user can view all plans
- [ ] Geo-location correctly determines INR/USD pricing
- [ ] Same plan purchase is blocked with appropriate message
- [ ] Upgrade shows quota stacking preview
- [ ] Downgrade shows zone loss warning
- [ ] Payment flow completes successfully
- [ ] Subscription status updates after purchase

### Zone Access

- [ ] Jobs show correct zone badge
- [ ] Locked zones are visually distinct
- [ ] Zone filter works correctly
- [ ] Zone add-on purchase flow works
- [ ] Purchased zones persist after plan change

### Application Quota

- [ ] Remaining applications display correctly
- [ ] Quota includes stacked + addon credits
- [ ] Job credit add-on increases limit
- [ ] Pay-per-job works for out-of-quota users
- [ ] Application counter updates on apply

### Edge Cases

- [ ] User with 0 remaining apps sees upgrade/addon options
- [ ] User at exactly limit cannot apply (shows options)
- [ ] Downgrade from unlimited (Premium) to limited plan
- [ ] Free tier with addon zones → upgrade preserves zones
- [ ] Multiple addon purchases accumulate correctly

---

## 9. Design Considerations

### Visual Hierarchy

1. **Pricing Page**: Premium should be visually prominent despite being rightmost
2. **Zone Badges**: Use consistent colors (Zone 1 = blue, Zone 2 = green, etc.)
3. **Locked State**: Gray overlay with lock icon, clear CTA to unlock

### Micro-copy

- "2 applications remaining" not "2/5 applications"
- "Unlock Zone 3" not "Buy Zone 3"
- "You'll keep your 2 remaining applications" for stacking

### Mobile Considerations

- Plan comparison should be swipeable cards on mobile
- Zone filter should be a bottom sheet
- Add-on purchase should be full-screen modal

---

## 10. Migration Notes

If existing users have old subscription data:

1. Old subscriptions without `stackedApplications` field default to 0
2. Old plans will be replaced by new seeded plans
3. Run `npm run seed:pricing` to reset all pricing data (dev only)

---

## Questions for Clarification

Before implementing, confirm:

1. Should we show "applications remaining" or "applications used of total"?
2. Should zone unlock persist forever or only for current subscription?
3. What happens to saved/bookmarked jobs in locked zones?
4. Should we allow partial refunds on downgrade?
