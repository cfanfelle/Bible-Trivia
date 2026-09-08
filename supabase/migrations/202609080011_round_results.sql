-- Finish a round atomically when the final player answers.
create or replace function public.answer_multiplayer_question(code_input text,selected_index_input integer)
returns integer language plpgsql security definer set search_path='' as $$
declare room public.game_rooms; question public.game_questions; awarded integer:=0; elapsed numeric;
begin
  select * into room from public.game_rooms where code=upper(trim(code_input)) for update;
  if room.id is null or room.status<>'answering' then raise exception 'Answers are not open.'; end if;
  if not exists(select 1 from public.game_players where room_id=room.id and user_id=auth.uid()) then raise exception 'Join the game first.'; end if;
  select * into question from public.game_questions where room_id=room.id and question_index=room.current_question;
  elapsed:=extract(epoch from (now()-room.phase_started_at));
  if selected_index_input=question.correct_index then awarded:=floor(300+700*greatest(0,least(1,(room.question_seconds-elapsed)/room.question_seconds))); end if;
  insert into public.game_answers values(room.id,room.current_question,auth.uid(),selected_index_input,selected_index_input=question.correct_index,awarded,now());
  update public.game_players set score=score+awarded where room_id=room.id and user_id=auth.uid();
  if not exists (
    select 1 from public.game_players p where p.room_id=room.id
    and not exists (select 1 from public.game_answers a where a.room_id=room.id
      and a.question_index=room.current_question and a.user_id=p.user_id)
  ) then
    update public.game_rooms set status='result',phase_started_at=now() where id=room.id;
  end if;
  return awarded;
exception when unique_violation then raise exception 'You already answered this question.';
end; $$;

create or replace function public.multiplayer_game_state(code_input text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare room public.game_rooms; question public.game_questions; member boolean; answer public.game_answers;
begin
  select * into room from public.game_rooms where code=upper(trim(code_input));
  member:=exists(select 1 from public.game_players where room_id=room.id and user_id=auth.uid());
  if room.id is null or not member then raise exception 'Game not found.'; end if;
  select * into question from public.game_questions where room_id=room.id and question_index=room.current_question;
  select * into answer from public.game_answers where room_id=room.id and question_index=room.current_question and user_id=auth.uid();
  return jsonb_build_object('code',room.code,'host',room.host_id=auth.uid(),'status',room.status,'questionSeconds',room.question_seconds,'readingSeconds',room.reading_seconds,'currentIndex',room.current_question,'questionCount',(select count(*) from public.game_questions where room_id=room.id),'phaseStartedAt',room.phase_started_at,'question',case when question.room_id is null then null else jsonb_build_object('bookId',question.book_id,'bookName',question.book_name,'chapter',question.chapter,'verseStart',question.verse_start,'verseEnd',question.verse_end,'text',question.question_text,'choices',question.choices,'correctIndex',case when room.status in ('result','finished') then question.correct_index else null end) end,'answer',case when answer.room_id is null then null else jsonb_build_object('selectedIndex',answer.selected_index,'correct',answer.correct,'points',answer.points) end,'players',(select coalesce(jsonb_agg(jsonb_build_object('userId',p.user_id,'username',p.username,'score',p.score,'questionPoints',case when room.status in ('result','finished') then coalesce((select a.points from public.game_answers a where a.room_id=room.id and a.question_index=room.current_question and a.user_id=p.user_id),0) else null end) order by p.score desc,p.joined_at),'[]'::jsonb) from public.game_players p where p.room_id=room.id));
end; $$;


-- Timer requests may arrive after the last answer. Match the phase and question
-- so a stale request cannot skip results or advance a later question.
create function public.expire_multiplayer_phase(code_input text, question_index_input integer, phase_input text)
returns void language plpgsql security definer set search_path='' as $$
declare room public.game_rooms;
begin
  select * into room from public.game_rooms where code=upper(trim(code_input)) for update;
  if auth.uid() is null or room.id is null or room.host_id<>auth.uid() then raise exception 'Only the leader can advance the game.'; end if;
  if room.current_question<>question_index_input or room.status<>phase_input then return; end if;
  if room.status='reading' and now()>=room.phase_started_at+room.reading_seconds*interval '1 second' then
    update public.game_rooms set status='answering',phase_started_at=now() where id=room.id;
  elsif room.status='answering' and now()>=room.phase_started_at+room.question_seconds*interval '1 second' then
    update public.game_rooms set status='result',phase_started_at=now() where id=room.id;
  end if;
end; $$;
revoke all on function public.expire_multiplayer_phase(text,integer,text) from public,anon;
grant execute on function public.expire_multiplayer_phase(text,integer,text) to authenticated;
