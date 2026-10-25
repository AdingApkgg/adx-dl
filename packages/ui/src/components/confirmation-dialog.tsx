"use client";

import { useRef, type ReactNode } from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { Button } from "./button";

/** Labels and operation ownership stay with the caller; confirmation never closes optimistically. */
export function ConfirmationDialog({ open, onOpenChange, title, description, confirmLabel, cancelLabel, pending = false, confirmDisabled = false, destructive = true, onConfirm }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  pending?: boolean;
  confirmDisabled?: boolean;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return <AlertDialogPrimitive.Root open={open} onOpenChange={next => { if (!pending) onOpenChange(next); }}>
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay data-motion-sensitive="" className="fixed inset-0 z-[90] bg-black/45 backdrop-blur-[2px] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
      <AlertDialogPrimitive.Content aria-busy={pending} data-motion-sensitive="" className="fixed inset-0 z-[91] m-auto h-fit max-h-[88dvh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto rounded-xl border bg-background p-6 shadow-2xl outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={event => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }); }}
        onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}>
        <AlertDialogPrimitive.Title className="text-lg font-semibold tracking-tight">{title}</AlertDialogPrimitive.Title>
        <AlertDialogPrimitive.Description asChild><div className="mt-3 space-y-2 break-words text-sm leading-7 text-muted-foreground">{description}</div></AlertDialogPrimitive.Description>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <AlertDialogPrimitive.Cancel asChild><Button type="button" variant="outline" className="min-h-11" disabled={pending}>{cancelLabel}</Button></AlertDialogPrimitive.Cancel>
          <AlertDialogPrimitive.Action asChild><Button type="button" variant={destructive ? "destructive" : "default"} className="min-h-11 whitespace-normal" disabled={pending || confirmDisabled} onClick={event => { event.preventDefault(); if (!pending && !confirmDisabled) onConfirm(); }}>{confirmLabel}</Button></AlertDialogPrimitive.Action>
        </div>
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  </AlertDialogPrimitive.Root>;
}
