"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";

const DialogCloseContext = createContext<(() => void) | null>(null);

export function useDialogClose() {
  return useContext(DialogCloseContext);
}

type DialogProps = {
  className?: string;
  children: ReactNode;
  description: string;
  protectDirtyChanges?: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
};

export function Dialog({
  children,
  className,
  description,
  protectDirtyChanges = true,
  onOpenChange,
  open,
  title,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [isDirty, setIsDirty] = useState(false);
  const [dismissMessage, setDismissMessage] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      setIsDirty(false);
      setDismissMessage("");
      dialog.showModal();
    }

    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function requestClose() {
    if (protectDirtyChanges && isDirty) {
      setDismissMessage("Tenés cambios sin guardar. Guardalos o descartalos antes de cerrar.");
      return;
    }
    onOpenChange(false);
  }

  function discardAndClose() {
    setIsDirty(false);
    setDismissMessage("");
    onOpenChange(false);
  }

  const visibleDismissMessage = protectDirtyChanges ? dismissMessage : "";

  return (
    <dialog
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className={className ? `admin-dialog ${className}` : "admin-dialog"}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      onClose={() => {
        if (open) onOpenChange(false);
      }}
      ref={dialogRef}
    >
      <div
        className={`admin-dialog-shell${visibleDismissMessage ? " has-dismiss-message" : ""}`}
        onChangeCapture={protectDirtyChanges ? () => setIsDirty(true) : undefined}
      >
        <header className="admin-dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{description}</p>
          </div>
          <button aria-label="Cerrar diálogo" className="dialog-close-button" onClick={requestClose} type="button">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        {visibleDismissMessage ? (
          <div className="dialog-dismiss-message" role="alert">
            <span>{visibleDismissMessage}</span>
            <button onClick={discardAndClose} type="button">Descartar cambios</button>
          </div>
        ) : null}
        <DialogCloseContext.Provider value={requestClose}>
          <div className="admin-dialog-content">{children}</div>
        </DialogCloseContext.Provider>
      </div>
    </dialog>
  );
}
