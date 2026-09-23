-- Atomic increment/decrement for active_subscriptions.applications_used.
-- src/services/applicationService.ts previously did a read-then-write
-- (select applications_used, then update to current + 1 in a separate
-- statement) - two concurrent POST /jobs/:jobId/apply requests for the same
-- student could read the same value and both write the same result,
-- undercounting and letting the student exceed the application limit
-- enforced in src/controllers/studentController.ts. Doing the increment as a
-- single UPDATE ... SET x = x + 1 inside the database makes it atomic.
create or replace function increment_applications_used(p_subscription_id uuid)
returns active_subscriptions
language sql
as $$
  update active_subscriptions
     set applications_used = applications_used + 1
   where id = p_subscription_id
  returning *;
$$;

-- Clamps at 0 instead of the caller's old "skip if already 0" check - no
-- caller reads the return value to distinguish "already zero" from
-- "decremented", so the simpler atomic clamp is behavior-equivalent here.
create or replace function decrement_applications_used(p_subscription_id uuid)
returns active_subscriptions
language sql
as $$
  update active_subscriptions
     set applications_used = greatest(applications_used - 1, 0)
   where id = p_subscription_id
  returning *;
$$;
