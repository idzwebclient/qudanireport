'use client';
import { useState } from 'react';
import { parseSen, senToInput } from '../lib/ledger';
import type { Branch } from '../lib/repo';
import { AmountInput } from './amount-input';

type Opening = Pick<Branch, 'opening_balance_sen' | 'opening_date' | 'opening_pl_sen' | 'opening_pl_date'>;

export function useOpeningForm(initial?: Partial<Opening>) {
  const [opening, setOpening] = useState(senToInput(initial?.opening_balance_sen ?? 0));
  const [openingDate, setOpeningDate] = useState(initial?.opening_date ?? '');
  const [plType, setPlType] = useState<'loss' | 'profit'>((initial?.opening_pl_sen ?? 0) > 0 ? 'profit' : 'loss');
  const [plAmount, setPlAmount] = useState(senToInput(Math.abs(initial?.opening_pl_sen ?? 0)));
  const [plDate, setPlDate] = useState(initial?.opening_pl_date ?? '');

  // Returns the values to save, or the reason they cannot be saved.
  function read(requireDate = false): { values: Opening } | { error: string } {
    const sen = opening.trim() ? parseSen(opening) : 0;
    const pl = plAmount.trim() ? parseSen(plAmount) : 0;
    if (sen === null || pl === null) return { error: 'Semak amaun. Contoh: 1500.50' };
    if (requireDate && !openingDate) return { error: 'Pilih tarikh untuk modal permulaan.' };
    if (pl && !plDate) return { error: 'Pilih tarikh untuk untung / rugi permulaan.' };
    return {
      values: {
        opening_balance_sen: sen,
        opening_date: openingDate || null,
        opening_pl_sen: plType === 'loss' ? -pl : pl,
        opening_pl_date: pl ? plDate : null,
      },
    };
  }

  function reset() {
    setOpening('');
    setOpeningDate('');
    setPlType('loss');
    setPlAmount('');
    setPlDate('');
  }

  return { opening, setOpening, openingDate, setOpeningDate, plType, setPlType, plAmount, setPlAmount, plDate, setPlDate, read, reset };
}

export function OpeningFields({ form, disabled, warning }: { form: ReturnType<typeof useOpeningForm>; disabled?: boolean; warning?: string }) {
  return (
    <>
      <fieldset className="setting-group" disabled={disabled}>
        <legend>Modal permulaan</legend>
        <AmountInput label="Amaun" value={form.opening} onChange={form.setOpening} disabled={disabled} />
        <label className="field">
          <span>Baki pada tarikh</span>
          <input type="date" value={form.openingDate} onChange={e => form.setOpeningDate(e.target.value)} />
        </label>
        <p className="muted">Baki sebelum rekod pada tarikh ini. Rekod lebih awal tidak dikira.</p>
        {warning && <div className="alert alert-warn">{warning}</div>}
      </fieldset>

      <fieldset className="setting-group" disabled={disabled}>
        <legend>Untung / rugi permulaan</legend>
        <p className="muted">Jumlah terkumpul sebelum mula guna sistem ini. Biarkan kosong jika tiada. Ia masuk ke tempoh selepas tarikh di bawah.</p>
        <div className="segmented" role="group" aria-label="Jenis">
          <button type="button" aria-pressed={form.plType === 'loss'} onClick={() => form.setPlType('loss')}>Rugi</button>
          <button type="button" aria-pressed={form.plType === 'profit'} onClick={() => form.setPlType('profit')}>Untung</button>
        </div>
        <AmountInput label="Amaun" value={form.plAmount} onChange={form.setPlAmount} disabled={disabled} />
        <label className="field">
          <span>Sehingga tarikh</span>
          <input type="date" value={form.plDate} onChange={e => form.setPlDate(e.target.value)} />
        </label>
      </fieldset>
    </>
  );
}
