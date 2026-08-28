-- Add the tenant-scoped superadmin role before any later migration references it.

alter type public.app_role add value if not exists 'superadmin';
