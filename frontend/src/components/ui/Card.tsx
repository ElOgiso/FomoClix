import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
}

export const Card: React.FC<CardProps> = ({ title, children, className = '', ...props }) => {
  return (
    <div className={`border border-[#1C1F26] bg-[#0E1118] rounded p-4 shadow-md ${className}`} {...props}>
      {title && (
        <div className="border-b border-[#1C1F26] pb-2 mb-3">
          <h3 className="text-white font-bold text-xs uppercase font-mono tracking-wider">{title}</h3>
        </div>
      )}
      {children}
    </div>
  );
};
