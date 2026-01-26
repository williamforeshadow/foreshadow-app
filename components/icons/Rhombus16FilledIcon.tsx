import React from 'react';

interface Rhombus16FilledIconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
}

const Rhombus16FilledIcon = ({
  size = 24,
  color = 'currentColor',
  className,
}: Rhombus16FilledIconProps) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path fill="currentColor" d="M3.892 4.069A1.75 1.75 0 0 1 5.504 3h7.748a1.75 1.75 0 0 1 1.611 2.431l-2.747 6.502a1.75 1.75 0 0 1-1.612 1.069H2.756a1.75 1.75 0 0 1-1.612-2.432z"/>
    </svg>
  );
};

export default Rhombus16FilledIcon;
