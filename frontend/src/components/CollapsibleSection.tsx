import React, { ReactNode, useState } from "react";

type CollapsibleSectionProps = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  headerActions?: ReactNode;
  className?: string;
};

export default function CollapsibleSection({
  title,
  description,
  children,
  defaultOpen = false,
  headerActions,
  className = "",
}: CollapsibleSectionProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`rounded-lg border border-neutral-800 bg-neutral-950/80 shadow-sm ${className}`}>
      <header className="flex flex-col gap-3 border-b border-neutral-800 p-4 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="group flex w-full flex-1 items-center justify-between gap-3 text-left sm:w-auto"
          aria-expanded={open}
        >
          <div>
            <h3 className="text-base font-semibold text-yellow-200">{title}</h3>
            {description ? (
              <p className="mt-1 text-sm text-neutral-300">{description}</p>
            ) : null}
          </div>
          <span
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900 text-neutral-200 transition-transform group-hover:border-yellow-300 group-hover:text-yellow-200 ${
              open ? "rotate-180" : ""
            }`}
            aria-hidden
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </span>
        </button>
        {headerActions ? <div className="sm:self-start">{headerActions}</div> : null}
      </header>
      {open ? <div className="space-y-4 p-4 sm:p-5">{children}</div> : null}
    </section>
  );
}
