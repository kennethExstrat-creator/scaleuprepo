-- =============================================================================================
-- Supabase shim for PGlite (tests/db and scripts/gen-db-types.ts).
--
-- Recreates the parts of a hosted Supabase database that supabase/migrations rely on, so the
-- migrations run unchanged on an in-process Postgres:
--   * API roles anon / authenticated / service_role (service_role bypasses RLS);
--   * schemas auth, storage, extensions (+ usage grants like Supabase);
--   * auth.users with the columns the migrations touch, and auth.uid() / auth.role() /
--     auth.email() / auth.jwt() reading request.jwt.claim(s) exactly like Supabase;
--   * storage.buckets / storage.objects (RLS enabled, all privileges to the API roles, as on
--     Supabase) and storage.foldername() / filename() / extension();
--   * Supabase's default privileges in schema public (ALL on new tables, sequences and functions
--     for anon, authenticated and service_role), so the tests prove that the migrations revoke them.
--
-- Differences from real Supabase (see supabase/README.md): postgres is a superuser here (on
-- Supabase it is a non-superuser with BYPASSRLS that owns the migrated objects); GoTrue, the
-- Storage API, PostgREST and pg_cron are not present; auth.users is a simplified table.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------------------------
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator nologin noinherit;
grant anon, authenticated, service_role to authenticator;

-- ---------------------------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------------------------
create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;

grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Supabase default privileges in public (what a fresh project has before our migrations)
-- ---------------------------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- auth
-- ---------------------------------------------------------------------------------------------
create table auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_sent_at timestamptz,
  recovery_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  is_super_admin boolean,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  phone text unique default null,
  phone_confirmed_at timestamptz,
  banned_until timestamptz,
  deleted_at timestamptz,
  is_sso_user boolean not null default false,
  is_anonymous boolean not null default false
);
create unique index users_email_partial_key on auth.users (email) where (is_sso_user = false);
grant all on auth.users to service_role;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.email(), auth.jwt() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- storage
-- ---------------------------------------------------------------------------------------------
create table storage.buckets (
  id text primary key,
  name text not null,
  owner uuid,
  owner_id text,
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index bname on storage.buckets using btree (name);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  user_metadata jsonb
);
create unique index bucketid_objname on storage.objects using btree (bucket_id, name);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

grant all on storage.buckets to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;

create or replace function storage.foldername(name text)
returns text[]
language plpgsql
immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

create or replace function storage.filename(name text)
returns text
language plpgsql
immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end
$$;

create or replace function storage.extension(name text)
returns text
language plpgsql
immutable
as $$
declare
  _parts text[];
  _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end
$$;

grant execute on function storage.foldername(text), storage.filename(text), storage.extension(text)
  to anon, authenticated, service_role;
