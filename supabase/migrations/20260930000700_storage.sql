-- =============================================================================================
-- Storage: private bucket for company documents. Contract: docs/ARCHITECTURE.md §2.8.
--
-- Object path: <company_id>/<period_close_id or 'general'>/<uuid>-<sanitised file name>
-- SELECT: anyone who can view the company named by the first folder.
-- INSERT: members of that (active) company, or a Fund Admin on behalf, and only at a well-formed
--   path: exactly <company_id>/<period close of that company or 'general'>/<file name>, lower-case
--   ids, no '.' / '..' / empty segments (private.can_upload_document_object).
-- No UPDATE / DELETE policies: documents are versioned, never replaced or removed in-app.
-- Uploads use signed upload URLs created server-side after a permission check; downloads use
-- 60-second signed URLs. These policies are the database backstop. A public.documents row can
-- only be added for an object that exists here (private.documents_before_insert), and downloads
-- should only ever be signed for storage_path values read from documents rows the caller can see.
-- =============================================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-documents',
  'company-documents',
  false,
  26214400, -- 25 MB
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists company_documents_select on storage.objects;
create policy company_documents_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'company-documents'
    and private.can_view_company(private.try_uuid((storage.foldername(name))[1]))
  );

drop policy if exists company_documents_insert on storage.objects;
create policy company_documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'company-documents'
    and private.can_upload_document_object(name)
  );
