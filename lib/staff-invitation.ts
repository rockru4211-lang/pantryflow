export const staffInviteHash = 'staff-invite=';
export function staffInvitationUrl(token: string, origin: string, demo=false) {
  const url=new URL(demo?'/demo':'/',origin);
  url.hash=staffInviteHash+encodeURIComponent(token);
  return url.toString();
}
export function readStaffInvitation(hash:string) {
  return new URLSearchParams(hash.replace(/^#/, '')).get('staff-invite')||'';
}
export function staffInvitationError(status:string) {
  return ({USED:'這份邀請已使用，請以自己的 PIN 登入。',EXPIRED:'這份邀請已過期，請主管重新產生邀請。',REVOKED:'這份邀請的門市授權已撤銷，請聯絡主管。'} as Record<string,string>)[status] || '這份邀請已失效，請主管重新產生邀請。';
}
