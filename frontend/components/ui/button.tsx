import * as React from 'react';
import { type VariantProps, cva } from 'class-variance-authority';
import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { sounds } from '@/lib/sounds';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center rounded-md text-sm font-medium whitespace-nowrap',
    'transition-all duration-[var(--duration-fast)] active:scale-[0.97]',
    'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none',
    'disabled:pointer-events-none disabled:opacity-50',
    'aria-invalid:ring-destructive/20 aria-invalid:border-destructive dark:aria-invalid:ring-destructive/40',
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        gradient:
          'text-white font-semibold shadow-xs bg-[linear-gradient(180deg,var(--color-primary-gradient-start),var(--color-primary-gradient-end))] shadow-[var(--shadow-button-inset)] hover:brightness-110',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        outline:
          'border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
        primary: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
      },
      size: {
        default: 'h-9 gap-1.5 px-4 py-2',
        xs: 'h-6 gap-1 px-2 text-xs',
        sm: 'h-8 gap-1 px-3',
        lg: 'h-10 gap-1.5 px-6',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-xs': 'size-6',
        'icon-lg': 'size-10',
      },
      pill: {
        true: 'rounded-full',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant,
  size,
  pill,
  onClick,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const handleClick = React.useCallback(
    (e: any) => {
      sounds.click();
      onClick?.(e);
    },
    [onClick]
  );

  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, pill, className }))}
      onClick={handleClick}
      {...props}
    />
  );
}

export { Button, buttonVariants };
