-- 20260922000001_media_storage_bucket.sql used `on conflict (id) do nothing`,
-- which only creates the bucket if missing - if a bucket with one of these
-- ids already existed (e.g. created public, or with weaker size/mime limits,
-- via the dashboard or an earlier manual setup), that migration silently
-- left it unchanged while still reporting success. Re-assert the intended
-- settings on every run instead.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('company-logos', 'company-logos', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('student-resumes', 'student-resumes', false, 5242880, array['application/pdf']),
  ('student-videos', 'student-videos', false, 32505856, array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/x-msvideo'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
