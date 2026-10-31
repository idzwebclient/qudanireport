'use client';

export function AmountInput({ label, value, onChange, autoFocus, large, disabled }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  large?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className={`amount${large ? ' amount-large' : ''}`}>
        <b>RM</b>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          aria-label={label}
          data-autofocus={autoFocus || undefined}
          disabled={disabled}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      </div>
    </label>
  );
}
