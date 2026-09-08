"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ProjectMemberOption } from "@/app/actions/tasks";

type AssigneePickerProps = {
  members: ProjectMemberOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
};

type AssigneeOption =
  | { id: null; label: "Sin asignar" }
  | { id: string; member: ProjectMemberOption };

function getMemberName(member: ProjectMemberOption): string {
  return member.full_name || member.email || "Integrante del proyecto";
}

export function getMemberInitials(member: ProjectMemberOption): string {
  const source = getMemberName(member).trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase() || "??";
}

export function AssigneeAvatars({
  assignees,
  className = "",
}: {
  assignees: ProjectMemberOption[];
  className?: string;
}) {
  const names = assignees.map(getMemberName);
  const label = names.length > 0 ? names.join(", ") : "Sin asignar";

  return (
    <span className={`project-task-assignee-summary${className ? ` ${className}` : ""}`} aria-label={label} title={label}>
      {assignees.length === 0 ? (
        <span className="project-task-avatar project-task-avatar-neutral" aria-hidden="true">—</span>
      ) : (
        <span className="project-task-avatar-stack" aria-hidden="true">
          {assignees.slice(0, 3).map((member) => (
            <span key={member.id} className="project-task-avatar">{getMemberInitials(member)}</span>
          ))}
          {assignees.length > 3 ? <span className="project-task-avatar project-task-avatar-more">+{assignees.length - 3}</span> : null}
        </span>
      )}
      <span className="project-task-assignee-summary-text">
        {assignees.length === 0 ? "Sin asignar" : assignees.length === 1 ? names[0] : `${assignees.length} asignados`}
      </span>
    </span>
  );
}

export function AssigneePicker({ members, selectedIds, onChange, disabled = false }: AssigneePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerId = useId();
  const listboxId = `${pickerId}-assignee-options`;

  const selectedMembers = members.filter((member) => selectedIds.includes(member.id));
  const options = useMemo<AssigneeOption[]>(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filteredMembers = members.filter((member) => {
      if (!normalizedQuery) return true;
      return `${member.full_name} ${member.email}`.toLocaleLowerCase().includes(normalizedQuery);
    });
    return [{ id: null, label: "Sin asignar" }, ...filteredMembers.map((member) => ({ id: member.id, member }))];
  }, [members, query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  function toggleOption(option: AssigneeOption) {
    if (option.id === null) {
      onChange([]);
      return;
    }
    onChange(
      selectedIds.includes(option.id)
        ? selectedIds.filter((id) => id !== option.id)
        : [...selectedIds, option.id],
    );
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(index + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      setHighlightedIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setHighlightedIndex(Math.max(options.length - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[highlightedIndex];
      if (option) toggleOption(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  const highlightedOption = options[highlightedIndex];
  const triggerLabel = selectedMembers.length > 0
    ? `Personas asignadas: ${selectedMembers.map(getMemberName).join(", ")}`
    : "Personas asignadas: Sin asignar";

  return (
    <div className="project-task-assignee-picker" ref={pickerRef}>
      <button
        type="button"
        className="project-task-assignee-trigger"
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <AssigneeAvatars assignees={selectedMembers} />
        <span className="project-task-assignee-trigger-chevron" aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div className="project-task-assignee-popover">
          <label className="project-task-assignee-search">
            <span className="board-visually-hidden">Buscar integrantes</span>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setHighlightedIndex(0);
              }}
              onKeyDown={handleInputKeyDown}
              placeholder="Buscar integrante…"
              role="combobox"
              aria-controls={listboxId}
              aria-expanded="true"
              aria-autocomplete="list"
              aria-activedescendant={highlightedOption ? `${listboxId}-${highlightedOption.id ?? "unassigned"}` : undefined}
            />
          </label>
          <ul id={listboxId} className="project-task-assignee-options" role="listbox" aria-label="Integrantes del proyecto" aria-multiselectable="true">
            {options.map((option, index) => {
              const isSelected = option.id === null ? selectedIds.length === 0 : selectedIds.includes(option.id);
              const optionId = `${listboxId}-${option.id ?? "unassigned"}`;
              return (
                <li
                  key={option.id ?? "unassigned"}
                  id={optionId}
                  role="option"
                  aria-selected={isSelected}
                  className={`project-task-assignee-option${index === highlightedIndex ? " is-highlighted" : ""}`}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => toggleOption(option)}
                >
                  {option.id === null ? (
                    <span className="project-task-avatar project-task-avatar-neutral" aria-hidden="true">—</span>
                  ) : (
                    <span className="project-task-avatar" aria-hidden="true">{getMemberInitials(option.member)}</span>
                  )}
                  <span className="project-task-assignee-option-copy">
                    <strong>{option.id === null ? option.label : getMemberName(option.member)}</strong>
                    {option.id !== null && option.member.email ? <span>{option.member.email}</span> : null}
                  </span>
                  <span className="project-task-assignee-check" aria-hidden="true">{isSelected ? "✓" : ""}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
