import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "placeholder:text-muted-foreground",
        "flex field-sizing-content min-h-16 w-full rounded-md px-4 py-3 text-base md:text-sm",
        "bg-neutral-100 dark:bg-neutral-800/80 border border-neutral-200 dark:border-neutral-700",
        "shadow-xs transition-[color,box-shadow] outline-none",
        "focus-visible:border-neutral-400 dark:focus-visible:border-neutral-500 focus-visible:ring-neutral-400/30 dark:focus-visible:ring-neutral-500/30 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
