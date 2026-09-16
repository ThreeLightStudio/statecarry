import * as React from 'react';
import { cn } from '@/lib/utils';

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-xl border bg-card text-card-foreground shadow-sm', className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('grid gap-1.5 p-6', className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('p-6 pt-0', className)} {...props} />;
}

export { Card, CardContent, CardHeader };
