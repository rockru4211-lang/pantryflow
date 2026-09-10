"use client";

import { useId, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import PasswordFeedback from './password-feedback';

/** The same input stays mounted so browser autofill, value and form ownership persist. */
export default function PasswordInput({strength=false,...props}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">&{strength?:boolean}) {
  const [visible, setVisible] = useState(false);
  const [entered,setEntered]=useState(String(props.defaultValue||''));const hintId=useId();
  const value=props.value===undefined?entered:String(props.value);
  return <><span className="password-field-control">
    <input {...props} type={visible ? "text" : "password"}
      aria-describedby={[props['aria-describedby'],strength?hintId:null].filter(Boolean).join(' ')||undefined}
      onChange={event=>{if(strength)setEntered(event.target.value);props.onChange?.(event);}} />
    <button type="button" className="password-visibility" aria-label={visible ? "隱藏密碼" : "顯示密碼"}
      aria-pressed={visible} aria-controls={props.id} onClick={() => setVisible(value => !value)}>
      {visible ? <EyeOff aria-hidden="true" size={20} /> : <Eye aria-hidden="true" size={20} />}
    </button>
  </span>{strength&&<PasswordFeedback id={hintId} value={value}/>}</>;
}
