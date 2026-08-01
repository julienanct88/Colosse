-- COLOSSE v35 — salon de challenges partagé
-- À exécuter une seule fois dans Supabase > SQL Editor.
-- Aucune donnée de santé n'est stockée ici : uniquement pseudo, défi, score et dates.

create extension if not exists pgcrypto;

create table if not exists public.challenge_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-F0-9]{6}$'),
  challenge_id text not null check (challenge_id in ('plank','wall_sit','pushups','crunch60','squat60')),
  title text not null check (char_length(title) between 1 and 80),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  ends_at timestamptz not null default (now() + interval '7 days'),
  check (ends_at > created_at)
);

create table if not exists public.challenge_members (
  room_id uuid not null references public.challenge_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 24),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.challenge_attempts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.challenge_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 24),
  score integer not null check (score between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists challenge_attempts_room_score_idx
  on public.challenge_attempts(room_id, score desc);

alter table public.challenge_rooms enable row level security;
alter table public.challenge_members enable row level security;
alter table public.challenge_attempts enable row level security;

-- Cette fonction évite les politiques récursives sur la table des membres.
create or replace function public.is_challenge_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.challenge_members m
    where m.room_id = p_room_id and m.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_challenge_member(uuid) from public;
grant execute on function public.is_challenge_member(uuid) to authenticated;

drop policy if exists "members read their rooms" on public.challenge_rooms;
create policy "members read their rooms"
on public.challenge_rooms for select to authenticated
using ((select public.is_challenge_member(id)));

drop policy if exists "members read participants" on public.challenge_members;
create policy "members read participants"
on public.challenge_members for select to authenticated
using ((select public.is_challenge_member(room_id)));

drop policy if exists "members read attempts" on public.challenge_attempts;
create policy "members read attempts"
on public.challenge_attempts for select to authenticated
using ((select public.is_challenge_member(room_id)));

drop policy if exists "members add own attempts" on public.challenge_attempts;

-- Création sécurisée : le code secret n'est visible que par les membres du salon.
create or replace function public.create_challenge(
  p_challenge_id text,
  p_title text,
  p_nickname text
)
returns setof public.challenge_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.challenge_rooms;
  v_code text;
  v_try integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if p_challenge_id not in ('plank','wall_sit','pushups','crunch60','squat60') then
    raise exception 'Challenge invalide';
  end if;
  if nullif(trim(p_nickname),'') is null then raise exception 'Pseudo requis'; end if;

  loop
    v_try := v_try + 1;
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text || auth.uid()::text),1,6));
    begin
      insert into public.challenge_rooms(code,challenge_id,title,created_by)
      values (v_code,p_challenge_id,left(coalesce(nullif(trim(p_title),''),'Challenge Colosse'),80),auth.uid())
      returning * into v_room;
      exit;
    exception when unique_violation then
      if v_try >= 5 then raise; end if;
    end;
  end loop;

  insert into public.challenge_members(room_id,user_id,nickname)
  values (v_room.id,auth.uid(),left(trim(p_nickname),24));
  return next v_room;
end;
$$;

-- Rejoindre nécessite le code à six caractères reçu dans le lien d'invitation.
create or replace function public.join_challenge(
  p_code text,
  p_nickname text
)
returns setof public.challenge_rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.challenge_rooms;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;
  if nullif(trim(p_nickname),'') is null then raise exception 'Pseudo requis'; end if;

  select * into v_room
  from public.challenge_rooms
  where code = upper(trim(p_code)) and ends_at > now();
  if not found then raise exception 'Challenge introuvable ou terminé'; end if;

  insert into public.challenge_members(room_id,user_id,nickname)
  values (v_room.id,auth.uid(),left(trim(p_nickname),24))
  on conflict (room_id,user_id) do update set nickname = excluded.nickname;
  return next v_room;
end;
$$;

-- Le score et le pseudo sont validés côté base : un participant ne peut pas
-- écrire pour un autre utilisateur ni dépasser le plafond de son défi.
create or replace function public.record_challenge_attempt(
  p_room_id uuid,
  p_score integer
)
returns setof public.challenge_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.challenge_attempts;
  v_nickname text;
  v_challenge_id text;
  v_max integer;
begin
  if auth.uid() is null then raise exception 'Authentification requise'; end if;

  select m.nickname, r.challenge_id
  into v_nickname, v_challenge_id
  from public.challenge_members m
  join public.challenge_rooms r on r.id = m.room_id
  where m.room_id = p_room_id
    and m.user_id = auth.uid()
    and r.ends_at > now();
  if not found then raise exception 'Challenge inaccessible ou terminé'; end if;

  v_max := case
    when v_challenge_id in ('plank','wall_sit') then 300
    when v_challenge_id = 'pushups' then 200
    else 120
  end;
  if p_score is null or p_score < 1 or p_score > v_max then raise exception 'Score invalide'; end if;

  insert into public.challenge_attempts(room_id,user_id,nickname,score)
  values (p_room_id,auth.uid(),v_nickname,p_score)
  returning * into v_attempt;
  return next v_attempt;
end;
$$;

revoke all on function public.create_challenge(text,text,text) from public;
revoke all on function public.join_challenge(text,text) from public;
revoke all on function public.record_challenge_attempt(uuid,integer) from public;
grant execute on function public.create_challenge(text,text,text) to authenticated;
grant execute on function public.join_challenge(text,text) to authenticated;
grant execute on function public.record_challenge_attempt(uuid,integer) to authenticated;

revoke all on public.challenge_rooms from anon, authenticated;
revoke all on public.challenge_members from anon, authenticated;
revoke all on public.challenge_attempts from anon, authenticated;
grant select on public.challenge_rooms to authenticated;
grant select on public.challenge_members to authenticated;
grant select on public.challenge_attempts to authenticated;
