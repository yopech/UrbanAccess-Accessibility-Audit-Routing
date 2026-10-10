import type { ButtonHTMLAttributes } from 'react';
export function Button({ className = '', variant = 'secondary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  return <button type="button" className={`field-button field-button-${variant} ${className}`} {...props} />;
}
