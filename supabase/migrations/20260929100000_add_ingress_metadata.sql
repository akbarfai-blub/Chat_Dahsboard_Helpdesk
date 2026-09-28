begin;

alter table public.ingress_events
  add column if not exists message_type text not null default 'text' check (message_type in ('text','photo','document','voice','video','audio','sticker','location','contact','other')),
  add column if not exists has_media boolean not null default false,
  add column if not exists is_forwarded boolean not null default false,
  add column if not exists caption text check (caption is null or length(caption) <= 1024),
  add column if not exists sent_at timestamptz,
  add column if not exists sender_info jsonb not null default '{}'::jsonb;

comment on column public.ingress_events.message_type is 'Normalized channel-agnostic message type classification.';
comment on column public.ingress_events.has_media is 'Boolean flag indicating whether the message includes media attachments.';
comment on column public.ingress_events.is_forwarded is 'Boolean flag indicating whether the message was forwarded.';
comment on column public.ingress_events.caption is 'Optional media caption provided with the message (up to 1024 chars).';
comment on column public.ingress_events.sent_at is 'Sender transmission timestamp from provider message; distinct from received_at server timestamp.';
comment on column public.ingress_events.sender_info is 'Informational sender profile details (e.g. first_name, username) not used as identity keys.';

commit;
