begin;

-- 1. Update conversations foreign key on identity_id to ON DELETE CASCADE
alter table public.conversations
  drop constraint if exists conversations_identity_id_fkey,
  add constraint conversations_identity_id_fkey
    foreign key (identity_id) references public.channel_identities(id) on delete cascade;

-- 2. Update messages foreign key on conversation_id to ON DELETE SET NULL
alter table public.messages
  drop constraint if exists messages_conversation_id_fkey,
  add constraint messages_conversation_id_fkey
    foreign key (conversation_id) references public.conversations(id) on delete set null;

-- 3. Add composite index covering identity_id for identity-aligned scope queries
create index if not exists conversations_scope_identity_activity
  on public.conversations(channel, account_id, chat_id, identity_id, last_activity_at desc);

comment on constraint conversations_identity_id_fkey on public.conversations is 'Cascades conversation cleanup when channel identity is purged.';
comment on constraint messages_conversation_id_fkey on public.messages is 'Preserves message record with null conversation_id when conversation container is merged or purged.';

commit;
