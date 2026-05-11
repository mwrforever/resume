import * as React from "react";
import { cn } from "@/lib/utils";

interface SelectContextValue {
  value: string;
  onValueChange: (value: string) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  selectedLabel: string;
  setSelectedLabel: (label: string) => void;
}

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelectContext() {
  const context = React.useContext(SelectContext);
  if (!context) {
    throw new Error("Select components must be used within a Select");
  }
  return context;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
}

function Select({ value, onValueChange, children }: SelectProps) {
  const [open, setOpen] = React.useState(false);
  const selectedLabel = React.useMemo(() => {
    let label = '';
    const visit = (nodes: React.ReactNode) => {
      React.Children.forEach(nodes, (child) => {
        if (!React.isValidElement(child) || label) return;
        const props = child.props as { value?: string; children?: React.ReactNode };
        if (props.value === value) {
          label = typeof props.children === 'string' ? props.children : '';
          return;
        }
        if (props.children) visit(props.children);
      });
    };
    visit(children);
    return label;
  }, [children, value]);
  const setSelectedLabel = React.useCallback((_label: string) => {}, []);

  return (
    <SelectContext.Provider value={{ value, onValueChange, open, setOpen, selectedLabel, setSelectedLabel }}>
      {open && (
        <div
          className="fixed inset-0 z-[90]"
          onMouseDown={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
      <div className={cn("relative", open ? "z-[100]" : "z-0")}>
        {children}
      </div>
    </SelectContext.Provider>
  );
}

interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, ...props }, ref) => {
    const { open, setOpen } = useSelectContext();
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-xl border border-border bg-white px-3 py-2 text-sm shadow-sm shadow-slate-200/40 ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        onClick={() => setOpen(!open)}
        {...props}
      >
        {children}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("transition-transform", open && "rotate-180")}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    );
  }
);
SelectTrigger.displayName = "SelectTrigger";

function SelectValue({ placeholder }: { placeholder?: string }) {
  const { value, selectedLabel } = useSelectContext();
  return <span>{(value && (selectedLabel || value)) || placeholder}</span>;
}

interface SelectContentProps {
  children: React.ReactNode;
  className?: string;
}

function SelectContent({ children, className }: SelectContentProps) {
  const { open, setOpen, onValueChange, setSelectedLabel } = useSelectContext();

  if (!open) return null;

  return (
    <div
      className={cn(
        "select-content absolute z-[110] mt-1 max-h-60 w-full overflow-auto rounded-xl border border-border bg-white p-1 shadow-xl shadow-slate-200/70",
        className
      )}
    >
      <div onClick={() => setOpen(false)}>
        {React.Children.map(children, (child) => {
          if (React.isValidElement(child)) {
            const item = child as React.ReactElement<SelectItemProps>;
            return React.cloneElement(item, {
              onSelect: () => {
                onValueChange(item.props.value);
                const label = typeof item.props.children === 'string' ? item.props.children : '';
                setSelectedLabel(label);
                setOpen(false);
              },
            });
          }
          return child;
        })}
      </div>
    </div>
  );
}

interface SelectItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
  onSelect?: () => void;
}

function SelectItem({ value, children, className, onSelect }: SelectItemProps) {
  const { value: selectedValue, onValueChange, setSelectedLabel } = useSelectContext();
  const isSelected = selectedValue === value;

  return (
    <div
      role="option"
      aria-selected={isSelected}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-lg py-1.5 pl-8 pr-2 text-sm outline-none hover:bg-sky-50 hover:text-primary",
        isSelected && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
        className
      )}
      onClick={() => {
        onValueChange(value);
        const label = typeof children === 'string' ? children : '';
        setSelectedLabel(label);
        onSelect?.();
      }}
    >
      {isSelected && (
        <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </span>
      )}
      {children}
    </div>
  );
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };