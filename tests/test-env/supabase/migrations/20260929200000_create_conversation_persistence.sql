begin;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.channel_identities(id),
  channel text not null check (btrim(channel) <> ''),
  account_id text not null check (btrim(account_id) <> ''),
  chat_id text not null check (btrim(chat_id) <> ''),
  status text not null default 'active' check (status in ('active', 'closed')),
  started_at timestamptz not null,
  last_activity_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_activity_at >= started_at)
);

create index conversations_scope_activity on public.conversations(channel, account_id, chat_id, last_activity_at desc);
create index conversations_identity on public.conversations(identity_id, last_activity_at desc);

comment on table public.conversations is 'P2.3 24-hour inactivity conversation container. Decoupled from complaint episodes and debounce.';
comment on column public.conversations.started_at is 'Reception timestamp of the first message in this conversation window.';
comment on column public.conversations.last_activity_at is 'Reception timestamp of the latest relevant activity in this conversation window (sliding window).';

alter table public.messages
  add column if not exists conversation_id uuid references public.conversations(id);

create index if not exists messages_conversation on public.messages(conversation_id, created_at);

revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;
grant select, insert, update, delete on public.conversations to service_role;

alter table public.conversations enable row level security;
create policy conversations_staff_read on public.conversations for select to authenticated using (true);

commit;
