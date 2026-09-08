import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export type AgeGroup = "under13" | "13to17" | "18plus";
export interface OnlineAccount { onlineUserId:string;email:string;username:string;ageGroup:AgeGroup;friendCode:string;verified:boolean;admin:boolean }
export interface FriendConnection { id:string;userId:string;username:string;status:"pending"|"accepted";direction:"incoming"|"outgoing"|"friend" }
export interface MultiplayerQuestion {bookId:string;bookName:string;chapter:number;verseStart:number;verseEnd:number;text:string;choices:string[];correctIndex:number}
export interface MultiplayerState {code:string;host:boolean;status:"lobby"|"reading"|"answering"|"result"|"finished";questionSeconds:number;readingSeconds:number;currentIndex:number;questionCount:number;phaseStartedAt:string|null;question:(Omit<MultiplayerQuestion,"correctIndex"|"choices">&{choices:string[]|null;correctIndex:number|null})|null;answer:{selectedIndex:number;correct:boolean;points:number}|null;players:{userId:string;username:string;score:number;questionPoints:number|null}[]}

export function subscribeToOnlineUsers(userId:string,onChange:(userIds:Set<string>)=>void){
  const channel=supabase.channel("online-friends",{config:{presence:{key:userId}}});
  channel
    .on("presence",{event:"sync"},()=>onChange(new Set(Object.keys(channel.presenceState()))))
    .subscribe(status=>{
      if(status==="SUBSCRIBED")void channel.track({userId,onlineAt:new Date().toISOString()});
    });
  return ()=>{
    void channel.untrack();
    void supabase.removeChannel(channel);
  };
}

export function onlineErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
}

async function accountFromUser(user: User): Promise<OnlineAccount> {
  const metadata = user.user_metadata as {
    username?: string;
    age_group?: AgeGroup;
    friend_code?: string;
  };
  const { data: profile } = await supabase
    .from("profiles")
    .select("username, age_group, friend_code")
    .eq("id", user.id)
    .maybeSingle();
  const { data: isAdmin } = await supabase.rpc("is_app_admin");
  return {
    onlineUserId: user.id,
    email: user.email ?? "",
    username: profile?.username ?? metadata.username ?? "BibleReader",
    ageGroup: profile?.age_group ?? metadata.age_group ?? "18plus",
    friendCode: profile?.friend_code ?? "Pending",
    verified: Boolean(user.email_confirmed_at),
    admin: Boolean(isAdmin),
  };
}

export async function restoreOnlineAccount() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session ? await accountFromUser(data.session.user) : null;
}

export async function signUpOnline(input: { email: string; password: string; username: string; ageGroup: AgeGroup }) {
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(), password: input.password,
    options: { data: { username: input.username.trim(), age_group: input.ageGroup } },
  });
  if (error) throw error;
  return data.session && data.user ? await accountFromUser(data.user) : null;
}

export async function signInOnline(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  return await accountFromUser(data.user);
}

export async function signOutOnline() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function sendPasswordRecovery(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
  if (error) throw error;
}

export async function isUsernameAvailable(username: string) {
  const { data, error } = await supabase.rpc("is_username_available", { candidate: username.trim() });
  if (error) throw error;
  return Boolean(data);
}

export async function uploadInitialProfile(onlineUserId: string) {
  const profileExport = await window.selah.invoke<{
    schemaVersion: number;
    sourceDeviceId: string;
    backupPath: string;
    exportedAt: string;
    data: unknown;
  }>("profile:sync-export", onlineUserId);
  const { error } = await supabase.from("profile_sync_snapshots").insert({
    user_id: onlineUserId,
    schema_version: profileExport.schemaVersion,
    source_device_id: profileExport.sourceDeviceId,
    snapshot: { exported_at: profileExport.exportedAt, data: profileExport.data },
  });
  if (error) {
    if (error.code === "23505") throw new Error("Cloud progress already exists. Automatic merging is not enabled yet, so nothing was overwritten.");
    throw error;
  }
  return profileExport.backupPath;
}

export async function hasUploadedProfile(onlineUserId: string) {
  const { data, error } = await supabase
    .from("profile_sync_snapshots")
    .select("user_id")
    .eq("user_id", onlineUserId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

type XpSyncEvent = { id: string; amount: number; source: string; createdAt: string };

export async function syncXpLedger(onlineUserId: string) {
  const pending = await window.selah.invoke<XpSyncEvent[]>("xp:sync-batch", onlineUserId);
  if (pending.length) {
    const { error } = await supabase.from("xp_events").upsert(
      pending.map((event) => ({
        id: event.id,
        user_id: onlineUserId,
        amount: event.amount,
        source: event.source,
        local_created_at: event.createdAt,
      })),
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) throw error;
    await window.selah.invoke("xp:mark-synced", pending.map((event) => event.id));
  }
  const { data, error } = await supabase
    .from("xp_events")
    .select("id, amount, source, local_created_at")
    .eq("user_id", onlineUserId);
  if (error) throw error;
  await window.selah.invoke("xp:apply-remote", (data ?? []).map((event) => ({
    id: event.id,
    amount: Number(event.amount),
    source: event.source,
    createdAt: event.local_created_at,
  })));
}

export async function syncReaderData(onlineUserId:string){
  const value=await window.selah.invoke<{sourceDeviceId:string;snapshot:unknown}>("reader:sync-export",onlineUserId);
  const {error}=await supabase.from("reader_sync_snapshots").upsert({user_id:onlineUserId,source_device_id:value.sourceDeviceId,snapshot:value.snapshot,updated_at:new Date().toISOString()},{onConflict:"user_id"});
  if(error)throw error;
}

export async function listFriendConnections() {
  const { data, error } = await supabase.rpc("list_friend_connections");
  if (error) throw error;
  return (data ?? []).map((row: {id:string;user_id:string;username:string;status:"pending"|"accepted";direction:"incoming"|"outgoing"|"friend"}) => ({
    id:row.id,userId:row.user_id,username:row.username,status:row.status,direction:row.direction,
  })) as FriendConnection[];
}

export async function sendFriendRequest(friendCode: string) {
  const { error } = await supabase.rpc("send_friend_request", { friend_code_input: friendCode.trim() });
  if (error) throw error;
}

export async function respondFriendRequest(id: string, accept: boolean) {
  const { error } = await supabase.rpc("respond_friend_request", { request_id:id, accept_request:accept });
  if (error) throw error;
}

export async function removeFriendConnection(id: string) {
  const { error } = await supabase.rpc("remove_friend_connection", { connection_id:id });
  if (error) throw error;
}

export async function createMultiplayerGame(bookIds:string[],questionCount:number,questionSeconds:number){
  const questions=await window.selah.invoke<MultiplayerQuestion[]>("multiplayer:questions",{bookIds,count:questionCount});
  const {data,error}=await supabase.rpc("create_multiplayer_game",{question_seconds_input:questionSeconds,questions_input:questions});
  if(error)throw error;return String(data);
}
export async function joinMultiplayerGame(code:string){const {data,error}=await supabase.rpc("join_multiplayer_game",{code_input:code});if(error)throw error;return String(data)}
export interface GameInvitation {id:string;code:string;username:string}
export async function inviteFriendToGame(code:string,friendId:string){const {error}=await supabase.rpc("invite_friend_to_game",{code_input:code,friend_id:friendId});if(error)throw error}
export async function listGameInvitations(){const {data,error}=await supabase.rpc("list_game_invitations");if(error)throw error;return (data??[]) as GameInvitation[]}
export async function dismissGameInvitation(id:string){const {error}=await supabase.rpc("dismiss_game_invitation",{invitation_id:id});if(error)throw error}
export async function getMultiplayerState(code:string){const {data,error}=await supabase.rpc("multiplayer_game_state",{code_input:code});if(error)throw error;return data as MultiplayerState}
export async function advanceMultiplayerGame(code:string){const {error}=await supabase.rpc("advance_multiplayer_game",{code_input:code});if(error)throw error}
export async function answerMultiplayerQuestion(code:string,selectedIndex:number){const {data,error}=await supabase.rpc("answer_multiplayer_question",{code_input:code,selected_index_input:selectedIndex});if(error)throw error;return Number(data)}

export async function expireMultiplayerPhase(code:string,questionIndex:number,phase:string){const {error}=await supabase.rpc("expire_multiplayer_phase",{code_input:code,question_index_input:questionIndex,phase_input:phase});if(error)throw error}
