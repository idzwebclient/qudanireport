'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { periodLabel, shiftPeriod } from '../lib/ledger';

export function PeriodNav({ period, onChange }: { period: string; onChange: (period: string) => void }) {
  return (
    <div className="datebar">
      <button className="icon-btn" aria-label="Tempoh sebelumnya" onClick={() => onChange(shiftPeriod(period, -1))}><ChevronLeft size={20} /></button>
      <div className="date-picker"><span>{periodLabel(period)}</span></div>
      <button className="icon-btn" aria-label="Tempoh seterusnya" onClick={() => onChange(shiftPeriod(period, 1))}><ChevronRight size={20} /></button>
    </div>
  );
}
