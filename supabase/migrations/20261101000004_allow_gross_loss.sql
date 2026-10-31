-- Gross profit is factory sale minus purchases, so a month can end in a gross loss.
alter table public.monthly_closings drop constraint monthly_closings_gross_profit_sen_check;
