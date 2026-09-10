"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

/** The same input stays mounted so browser autofill, value and form ownership persist. */
export default function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);
  return <span className="password-field-control">
    <input {...props} type={visible ? "text" : "password"} />
    <button type="button" className="password-visibility" aria-label={visible ? "隱藏密碼" : "顯示密碼"}
      aria-pressed={visible} aria-controls={props.id} onClick={() => setVisible(value => !value)}>
      {visible ? <EyeOff aria-hidden="true" size={20} /> : <Eye aria-hidden="true" size={20} />}
    </button>
  </span>;
}
