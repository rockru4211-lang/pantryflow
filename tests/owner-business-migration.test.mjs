import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260825090816_store_first_onboarding_auth_fix.sql', import.meta.url),
  'utf8',
);

test('Owner authorization does not trust user-editable Auth metadata', () => {
  assert.doesNotMatch(migration, /raw_user_meta_data|user_metadata|account_type/i);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /auth\.users/);
  assert.match(migration, /email_confirmed_at/);
  assert.match(migration, /public\.profiles/);
  assert.match(migration, /p\.display_name/);
  assert.match(migration, /public\.organization_members/);
  assert.match(migration, /om\.is_active/);
});

test('Owner onboarding is serialized, atomic, and replay-safe', () => {
  const lock = migration.indexOf('pg_advisory_xact_lock');
  const firstOrganizationInsert = migration.indexOf('insert into public.organizations');
  assert(lock > 0 && firstOrganizationInsert > lock);
  assert.match(migration, /OWNER_ALREADY_ONBOARDED/);
  assert.match(migration, /'replayed', true/);
  assert.match(migration, /'replayed', false/);
  for (const table of [
    'organizations',
    'profiles',
    'organization_members',
    'staff_identities',
    'stores',
    'store_memberships',
    'audit_logs',
  ]) assert.match(migration, new RegExp(`public\\.${table}`));
});

test('public RPC is a fixed-search-path compatibility wrapper with least privilege', () => {
  assert.match(migration, /create or replace function private\.create_owner_business_internal/);
  assert.match(migration, /create or replace function public\.create_owner_business/);
  assert.match(migration, /security definer\s+set search_path = ''/);
  assert.match(migration, /revoke all on function public\.create_owner_business[\s\S]*from public, anon, service_role/);
  assert.match(migration, /grant execute on function public\.create_owner_business[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /grant execute on function [^;]+ to (?:anon|public)\s*;/i);
});

test('negative authorization paths fail before tenant writes', () => {
  const firstWrite = migration.indexOf('insert into public.organizations');
  for (const guard of [
    'OWNER_AUTH_REQUIRED',
    'OWNER_EMAIL_NOT_VERIFIED',
    'OWNER_PROFILE_MISSING',
    'OWNER_PROFILE_DISPLAY_NAME_REQUIRED',
    'OWNER_ALREADY_ONBOARDED',
  ]) {
    const position = migration.indexOf(guard);
    assert(position > 0 && position < firstWrite, `${guard} must guard the first write`);
  }
});
