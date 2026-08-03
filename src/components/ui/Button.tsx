import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
}

export const Button: React.FC<ButtonProps> = ({ variant = 'primary', children, className = '', ...props }) => {
  const baseStyle = 'px-3 py-1.5 text-xs font-mono font-bold uppercase rounded border transition-all cursor-pointer';
  let variantStyle = '';

  if (variant === 'primary') {
    variantStyle = 'bg-indigo-600 border-indigo-500 hover:bg-indigo-500 text-white';
  } else if (variant === 'secondary') {
    variantStyle = 'bg-[#151214] border-gray-700 text-gray-300 hover:bg-gray-800';
  } else if (variant === 'danger') {
    variantStyle = 'bg-rose-950/20 border-rose-900 text-rose-400 hover:bg-rose-900/40';
  }

  return (
    <button className={`${baseStyle} ${variantStyle} ${className}`} {...props}>
      {children}
    </button>
  );
};
