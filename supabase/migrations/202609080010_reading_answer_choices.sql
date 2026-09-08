-- Show choices during reading; answer submissions still require the answering phase.
create or replace function public.multiplayer_game_state(code_input text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare room public.game_rooms; question public.game_questions; member boolean; answer public.game_answers;
begin
  select * into room from public.game_rooms where code=upper(trim(code_input));
  member:=exists(select 1 from public.game_players where room_id=room.id and user_id=auth.uid());
  if room.id is null or not member then raise exception 'Game not found.'; end if;
  select * into question from public.game_questions where room_id=room.id and question_index=room.current_question;
  select * into answer from public.game_answers where room_id=room.id and question_index=room.current_question and user_id=auth.uid();
  return jsonb_build_object('code',room.code,'host',room.host_id=auth.uid(),'status',room.status,'questionSeconds',room.question_seconds,'readingSeconds',room.reading_seconds,'currentIndex',room.current_question,'questionCount',(select count(*) from public.game_questions where room_id=room.id),'phaseStartedAt',room.phase_started_at,'question',case when question.room_id is null then null else jsonb_build_object('bookId',question.book_id,'bookName',question.book_name,'chapter',question.chapter,'verseStart',question.verse_start,'verseEnd',question.verse_end,'text',question.question_text,'choices',question.choices,'correctIndex',case when room.status in ('result','finished') then question.correct_index else null end) end,'answer',case when answer.room_id is null then null else jsonb_build_object('selectedIndex',answer.selected_index,'correct',answer.correct,'points',answer.points) end,'players',(select coalesce(jsonb_agg(jsonb_build_object('userId',p.user_id,'username',p.username,'score',p.score) order by p.score desc,p.joined_at),'[]'::jsonb) from public.game_players p where p.room_id=room.id));
end; $$;
