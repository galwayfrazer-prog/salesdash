update public.sales_os_approved_emails
set active = false,
    updated_at = now()
where email = 'filip.stojanovic@wildvision.io';

update public.sales_os_members
set active = false,
    updated_at = now()
where email = 'filip.stojanovic@wildvision.io';
