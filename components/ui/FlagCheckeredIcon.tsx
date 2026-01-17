import React from 'react';

interface FlagCheckeredIconProps {
  size?: number | string;
  color?: string;
  strokeWidth?: number;
  background?: string;
  opacity?: number;
  rotation?: number;
  shadow?: number;
  flipHorizontal?: boolean;
  flipVertical?: boolean;
  padding?: number;
  className?: string;
}

const FlagCheckeredIcon = ({
  size = undefined,
  color = 'currentColor',
  strokeWidth = 2,
  background = 'transparent',
  opacity = 1,
  rotation = 0,
  shadow = 0,
  flipHorizontal = false,
  flipVertical = false,
  padding = 0,
  className
}: FlagCheckeredIconProps) => {
  const transforms: string[] = [];
  if (rotation !== 0) transforms.push(`rotate(${rotation}deg)`);
  if (flipHorizontal) transforms.push('scaleX(-1)');
  if (flipVertical) transforms.push('scaleY(-1)');

  const viewBoxSize = 24 + (padding * 2);
  const viewBoxOffset = -padding;
  const viewBox = `${viewBoxOffset} ${viewBoxOffset} ${viewBoxSize} ${viewBoxSize}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={viewBox}
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{
        opacity,
        transform: transforms.length > 0 ? transforms.join(' ') : undefined,
        filter: shadow > 0 ? `drop-shadow(0 ${shadow}px ${shadow * 2}px rgba(0,0,0,0.3))` : undefined,
        backgroundColor: background !== 'transparent' ? background : undefined
      }}
    >
      {/* Flag pole */}
      <line x1="4" y1="4" x2="4" y2="22" stroke="currentColor" strokeWidth={strokeWidth} />
      
      {/* Checkered flag pattern */}
      <g>
        {/* Black squares */}
        <rect x="4" y="4" width="3" height="3" fill="currentColor" />
        <rect x="10" y="4" width="3" height="3" fill="currentColor" />
        <rect x="16" y="4" width="3" height="3" fill="currentColor" />
        
        <rect x="7" y="7" width="3" height="3" fill="currentColor" />
        <rect x="13" y="7" width="3" height="3" fill="currentColor" />
        
        <rect x="4" y="10" width="3" height="3" fill="currentColor" />
        <rect x="10" y="10" width="3" height="3" fill="currentColor" />
        <rect x="16" y="10" width="3" height="3" fill="currentColor" />
        
        <rect x="7" y="13" width="3" height="3" fill="currentColor" />
        <rect x="13" y="13" width="3" height="3" fill="currentColor" />
        
        {/* White squares (with stroke to show outline) */}
        <rect x="7" y="4" width="3" height="3" fill="white" stroke="currentColor" strokeWidth="0.5" />
        <rect x="13" y="4" width="3" height="3" fill="white" stroke="currentColor" strokeWidth="0.5" />
        
        <rect x="4" y="7" width="3" height="3" fill="white" stroke="currentColor" strokeWidth="0.5" />
        <rect x="10" y="7" width="3" height="3" fill="white" stroke="currentColor" strokeWidth="0.5" />
        <rect x="16" y="7" width="3" height="3" fill="white" stroke="currentColor" strokeWidth="0.5" />
        
        <rect x="7" y="10" width="3" height="3" fill="white" stroke="currentColor" strokeWidth="0.5" />
        <rect x="13" y="10" width="3" height="3" fill="white" stroke="currentColor" strokeWidth="0.5" />
        
        <rect x="4" y="13" width="3" height="3" fill="white" stroke="currentColor" strokeWidth="0.5" />
        <rect x="10" y="13" width="3" height="3" fill="white" stroke="currentColor" strokeWidth="0.5" />
        <rect x="16" y="13" width="3" height="3" fill="white" stroke="currentColor" strokeWidth="0.5" />
      </g>
    </svg>
  );
};

export default FlagCheckeredIcon;
