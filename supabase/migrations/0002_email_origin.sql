-- Who created an email draft: the system (from the rubric bands) or Arjun (his own choice
-- for a Review-band candidate). The system never replaces or removes Arjun's drafts.
alter table emails add column if not exists origin text not null default 'system'
  check (origin in ('system', 'arjun'));
