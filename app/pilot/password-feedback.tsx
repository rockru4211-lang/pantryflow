import {assessPassword,passwordAdvice} from '@/lib/password-strength';
export default function PasswordFeedback({value,id}:{value:string;id:string}){
 const result=value?assessPassword(value):null;
 return <span id={id} className="password-feedback" aria-live="polite" aria-atomic="true">
  {result?<><strong className={`password-strength-${result.score}`}>密碼強度：{result.level}</strong><span>{result.tips.join(' ')}</span></>:<span>{passwordAdvice}</span>}
  <small>僅在此裝置評估，不傳送至第三方評分服務。</small>
 </span>;
}
