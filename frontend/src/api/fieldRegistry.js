// Field registry — the schema-driven display layer.
//
// The database schema grows every few migrations. Rather than hardcode each field
// in PersonProfile (and re-touch the component every time a column is added), the
// person record is rendered from THIS config by <RecordDetail>. To surface a new
// column in the UI, add ONE entry here — no component change, no redesign.
//
// Each entry:
//   key       response field on the person object (the API normalizes DB columns,
//             e.g. canonical_name → full_name, sex → gender, birth_year_estimate →
//             birth_year; year-estimation metadata rides as `${key}_source`, etc.)
//   label     human label (end-user wording, not the column name)
//   priority  higher renders first; the highest-use fields lead (objective b).
//   format    'yearEstimate' | 'mono' | 'pct' | (default: plain text)
//
// A field renders only when it has a value, so entries for columns the API may or
// may not return are safe — they surface if present, and are skipped if absent.
//
// NOT included on purpose:
//   - name / person_type / classification — already in the profile header.
//   - confidence_score — enslaved leads carry a flat, uninformative 0.85 (see the
//     NY-probate audit); surfacing it per-record would mislead. Left out until
//     confidence is scored per-record (issue #70).

export const PERSON_FIELDS = [
  { key: 'birth_year',         label: 'Birth year',         priority: 100, format: 'yearEstimate' },
  { key: 'death_year',         label: 'Death year',         priority: 98,  format: 'yearEstimate' },
  { key: 'location',           label: 'Location',           priority: 90 },
  { key: 'primary_plantation', label: 'Plantation',         priority: 85 },
  { key: 'occupation',         label: 'Occupation',         priority: 80 },
  { key: 'gender',             label: 'Gender',             priority: 70 },
  { key: 'freedom_year',       label: 'Freedom year',       priority: 68,  format: 'yearEstimate' },
  { key: 'racial_designation', label: 'Racial designation', priority: 60 },
  // These may or may not be present on the response — they demonstrate the
  // "one line surfaces a growing-schema column" property: present → shown, absent → skipped.
  { key: 'primary_state',      label: 'State',              priority: 52 },
  { key: 'primary_county',     label: 'County',             priority: 50 },
  { key: 'status',             label: 'Status',             priority: 30 },
];
