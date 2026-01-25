'use client';

import { useState } from 'react';

interface UserAvatarProps {
  src?: string | null;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function UserAvatar({ src, name, size = 'md', className = '' }: UserAvatarProps) {
  const [imageError, setImageError] = useState(false);

  // Size mappings
  const sizeClasses = {
    xs: 'w-4 h-4 text-[8px]',
    sm: 'w-6 h-6 text-xs',
    md: 'w-8 h-8 text-sm',
    lg: 'w-10 h-10 text-base',
    xl: 'w-12 h-12 text-lg',
  };

  // Get initials from name
  const getInitials = (name: string) => {
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  // Check if src is a valid URL (not an emoji or empty)
  const isValidImageUrl = src && !imageError && (src.startsWith('http') || src.startsWith('/'));

  if (isValidImageUrl) {
    return (
      <img
        src={src}
        alt={name}
        className={`${sizeClasses[size]} rounded-full object-cover ${className}`}
        onError={() => setImageError(true)}
      />
    );
  }

  // Fallback to initials
  return (
    <div
      className={`${sizeClasses[size]} rounded-full bg-primary/10 text-primary font-medium flex items-center justify-center ${className}`}
      title={name}
    >
      {getInitials(name)}
    </div>
  );
}
