import {useId,useState} from 'react';
import {Eye,EyeOff} from 'lucide-react';
import './auth-forms.css';

type Props={label:string;name:string;value:string;onChange:(value:string)=>void;error?:string;hint?:string;autoComplete:'new-password'|'current-password';toggleLabel:string;disabled?:boolean};

/** Campo de senha com mostrar/ocultar. O rótulo fica fora do botão para o nome acessível do campo ser exato. */
export function PasswordField({label,name,value,onChange,error,hint,autoComplete,toggleLabel,disabled}:Props){
  const id=useId();const [shown,setShown]=useState(false);
  const describedBy=[error?`${id}-err`:null,hint?`${id}-hint`:null].filter(Boolean).join(' ')||undefined;
  return <div className="pw-field">
    <label htmlFor={id}>{label}</label>
    <div className="pw-row">
      <input id={id} name={name} type={shown?'text':'password'} value={value} onChange={event=>onChange(event.target.value)} autoComplete={autoComplete} aria-invalid={Boolean(error)||undefined} aria-describedby={describedBy} disabled={disabled} spellCheck={false} autoCapitalize="none"/>
      <button type="button" className="pw-toggle" aria-label={`${shown?'Ocultar':'Mostrar'} ${toggleLabel}`} aria-pressed={shown} onClick={()=>setShown(value=>!value)}>{shown?<EyeOff size={18} aria-hidden="true"/>:<Eye size={18} aria-hidden="true"/>}</button>
    </div>
    {hint&&<small id={`${id}-hint`} className="pw-hint">{hint}</small>}
    {error&&<div id={`${id}-err`} className="form-error" role="alert">{error}</div>}
  </div>
}
