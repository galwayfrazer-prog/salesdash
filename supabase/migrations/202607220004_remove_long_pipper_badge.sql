update public.kv_store
set value = coalesce(
  (
    select jsonb_agg(badge)
    from jsonb_array_elements(value::jsonb) badge
    where not (
      lower(btrim(coalesce(badge ->> 'name', ''))) = 'long pipper'
      and lower(btrim(coalesce(badge ->> 'recipientEmail', ''))) = 'filip.stojanovic@wildvision.io'
    )
  ),
  '[]'::jsonb
)::text
where key = 'badges:all'
  and value is not null
  and pg_input_is_valid(value, 'jsonb')
  and jsonb_typeof(value::jsonb) = 'array';
