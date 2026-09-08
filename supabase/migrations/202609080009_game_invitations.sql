create table public.game_invitations (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.game_rooms(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(room_id, recipient_id)
);
alter table public.game_invitations enable row level security;
revoke all on public.game_invitations from public, anon, authenticated;

create function public.invite_friend_to_game(code_input text, friend_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare room public.game_rooms;
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  select * into room from public.game_rooms where code=upper(trim(code_input)) for update;
  if room.id is null or room.host_id<>auth.uid() or room.status<>'lobby' then
    raise exception 'Only the host can invite friends to an open lobby.';
  end if;
  if not exists(select 1 from public.friendships where status='accepted' and
    ((requester_id=auth.uid() and addressee_id=friend_id) or (addressee_id=auth.uid() and requester_id=friend_id))) then
    raise exception 'Choose someone from your friends list.';
  end if;
  if (select count(*) from public.game_players where room_id=room.id)>=20 then raise exception 'This game is full.'; end if;
  if exists(select 1 from public.game_players where room_id=room.id and user_id=friend_id) then raise exception 'Your friend already joined.'; end if;
  insert into public.game_invitations(room_id,recipient_id) values(room.id,friend_id) on conflict do nothing;
end; $$;

create function public.list_game_invitations()
returns table(id uuid, code text, username text)
language sql stable security definer set search_path='' as $$
  select i.id,r.code,p.username from public.game_invitations i
  join public.game_rooms r on r.id=i.room_id
  join public.profiles p on p.id=r.host_id
  where i.recipient_id=auth.uid() and r.status='lobby'
    and i.created_at>now()-interval '24 hours'
    and not exists(select 1 from public.game_players gp where gp.room_id=r.id and gp.user_id=auth.uid())
  order by i.created_at desc;
$$;

create function public.dismiss_game_invitation(invitation_id uuid)
returns void language sql security definer set search_path='' as $$
  delete from public.game_invitations where id=invitation_id and recipient_id=auth.uid();
$$;

revoke all on function public.invite_friend_to_game(text,uuid),public.list_game_invitations(),public.dismiss_game_invitation(uuid) from public,anon;
grant execute on function public.invite_friend_to_game(text,uuid),public.list_game_invitations(),public.dismiss_game_invitation(uuid) to authenticated;
