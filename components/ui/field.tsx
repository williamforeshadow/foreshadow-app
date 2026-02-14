"use client";

import * as React from "react";
import { Field } from "@base-ui-components/react/field";
import { cn } from "@/lib/utils";
import styles from "./field.module.css";

/* ------------------------------------------------------------------ */
/* Base-UI wrappers (existing)                                        */
/* ------------------------------------------------------------------ */

function FieldRoot({ className, ...props }: Field.Root.Props) {
  return (
    <Field.Root
      className={cn(styles.root, className)}
      data-slot="field"
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: Field.Label.Props) {
  return (
    <Field.Label
      className={cn(styles.label, className)}
      data-slot="field-label"
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: Field.Description.Props) {
  return (
    <Field.Description
      className={cn(styles.description, className)}
      data-slot="field-description"
      {...props}
    />
  );
}

function FieldError({ className, ...props }: Field.Error.Props) {
  return (
    <Field.Error
      className={cn(styles.error, className)}
      data-slot="field-error"
      {...props}
    />
  );
}

const FieldControl = Field.Control;
const FieldValidity = Field.Validity;

/* ------------------------------------------------------------------ */
/* Layout / grouping primitives (new)                                 */
/* ------------------------------------------------------------------ */

function FieldSet({
  className,
  ...props
}: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn("space-y-4 border-none p-0 m-0", className)}
      {...props}
    />
  );
}

function FieldLegend({
  className,
  ...props
}: React.ComponentProps<"legend">) {
  return (
    <legend
      data-slot="field-legend"
      className={cn(
        "text-foreground text-sm font-medium leading-none p-0",
        className
      )}
      {...props}
    />
  );
}

function FieldGroup({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn("space-y-6", className)}
      {...props}
    />
  );
}

function FieldTitle({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-title"
      className={cn(
        "text-foreground text-base font-medium leading-none",
        className
      )}
      {...props}
    />
  );
}

function FieldContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn("space-y-2", className)}
      {...props}
    />
  );
}

function FieldSeparator({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-separator"
      role="separator"
      className={cn("bg-border h-px w-full", className)}
      {...props}
    />
  );
}

export {
  FieldRoot as Field,
  FieldContent,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
  FieldValidity,
};
