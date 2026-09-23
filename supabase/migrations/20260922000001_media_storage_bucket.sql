-- Private storage buckets for uploaded media, replacing the Bucketeer-
-- managed AWS S3 bucket. One bucket per content type (rather than a single
-- bucket with key prefixes) so each gets its own size/mime constraints as a
-- defense-in-depth backstop behind the multer limits already enforced in
-- src/middleware/upload.js.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('company-logos', 'company-logos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']), -- 2 MiB, matches MAX_FILE_SIZE_BYTES
  ('student-resumes', 'student-resumes', false, 5242880, array['application/pdf']), -- 5 MiB, matches MAX_RESUME_SIZE_BYTES
  ('student-videos', 'student-videos', false, 32505856, array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/x-msvideo']) -- 31 MiB, matches MAX_VIDEO_SIZE_BYTES
on conflict (id) do nothing;

-- Same access model as 20260921000009_rls_policies.sql: the Express backend
-- is the only caller, using Storage S3 credentials scoped to service_role,
-- which already bypasses RLS by default. This policy is defense-in-depth /
-- documentation, not a functional requirement.
create policy "service_role_full_access_media"
on storage.objects for all
to service_role
using (bucket_id in ('company-logos', 'student-resumes', 'student-videos'))
with check (bucket_id in ('company-logos', 'student-resumes', 'student-videos'));
