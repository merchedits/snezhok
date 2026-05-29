import React, { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  className?: string;
}

export default function Input({
  label,
  className = "",
  id,
  ...props
}: InputProps) {
  const inputId = id || React.useId();

  return (
    <div className="form-group">
      {label && (
        <label htmlFor={inputId} className="form-label">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`input ${className}`}
        {...props}
      />
    </div>
  );
}
