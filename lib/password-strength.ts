export const passwordAdvice = '至少 8 個字元，建議 10 個以上；避免姓名、生日、常見字串及重複使用的密碼。';
export type PasswordStrength = {level:'弱'|'中'|'強';score:1|2|3;tips:string[]};

/** Advisory only. No requests, storage, logging, or changes to Auth validation. */
export function assessPassword(password:string):PasswordStrength {
 const value=password.normalize('NFKC');const characters=Array.from(value);const length=characters.length;
 const normalized=value.toLowerCase().replace(/[@4]/g,'a').replace(/[03]/g,c=>c==='0'?'o':'e').replace(/[!1]/g,'i').replace(/[5$]/g,'s').replace(/[^a-z]/g,'');
 const common=['password','passcode','admin','welcome','letmein','qwerty','qazwsx','asdfgh','zxcvbn','abcdef','iloveyou','pantryflow','test','login','changeme','dragon','monkey','football','baseball','superman','princess','sunshine','master','secret','trustno','whatever','nothing','michael','jessica','charlie','donald','freedom','hello'].some(word=>normalized.startsWith(word));
 const repeated=/^(.{1,4})\1+$/u.test(value)||new Set(characters.map(c=>c.toLowerCase())).size<4;
 const sequential=/^(0123456789|1234567890|abcdefghijklmnopqrstuvwxyz|qwertyuiop|asdfghjkl|zxcvbnm)$/i.test(value)||/^[^\d]{0,3}\d{5,}[^\d]{0,3}$/.test(value);
 const kinds=[/\p{Ll}/u,/\p{Lu}/u,/\p{N}/u,/[^\p{L}\p{N}\s]/u,/\p{Lo}/u].filter(pattern=>pattern.test(value)).length;
 const tips:string[]=[];
 if(length<10)tips.push('加長至至少 10 個字元，或使用較長的密碼片語。');
 if(common||repeated||sequential)tips.push('避開常見字詞、連號與重複字元。');
 const score=length<8||common||repeated||sequential?1:((length>=12&&kinds>=3)||(length>=16&&new Set(characters).size>=8))?3:2;
 if(score===2)tips.push('再加長密碼，或搭配不同種類的字元。');
 tips.push('不要與其他服務重複使用；可交由密碼管理器產生與保存。');
 return {score,level:score===1?'弱':score===2?'中':'強',tips};
}
