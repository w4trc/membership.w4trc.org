/**
 * Meeting agendas: the checklist each meeting follows, the fields officers
 * fill in, carrying unfinished business forward, and the money received since
 * the last meeting for the treasurer's report.
 *
 * The order follows the club's paper agenda (Robert's Rules). A board meeting
 * uses the same order without the parts meant for a general meeting: welcome,
 * pledge, prayer, recess and the presentation.
 */

import { POSITIONS } from './officers.js';

const step = (key, label, extra = {}) => ({ key, label, ...extra });

// `general: true` marks a part only general (non-board) meetings have.
// `list` names the block the page shows in that section: officer reports,
// business items, motions, announcements, the presentation, or the next meeting.
// It comes before the steps, or right after the step named by `listAfter`.
const SECTIONS = [
  {
    key: 'opening', title: 'Call to Order & Opening',
    steps: [
      step('call_to_order', 'Call meeting to order', { hint: '"The meeting will come to order."', time: 'called_to_order' }),
      step('welcome', 'Welcome members, guests, and visitors; ask guests to introduce themselves', { general: true }),
      step('pledge', 'Pledge of Allegiance', { general: true, field: 'pledge_by', fieldLabel: 'Led by' }),
      step('prayer', 'Opening prayer', { general: true, field: 'prayer_by', fieldLabel: 'Led by' }),
      step('quorum', 'Quorum confirmed by Secretary', { hint: 'Per club bylaws.' }),
    ],
  },
  {
    key: 'minutes', title: 'Minutes of Previous Meeting',
    steps: [
      step('minutes_read', 'Secretary reads (or confirms distribution of) minutes from last meeting'),
      step('minutes_corrections', '"Are there any corrections to the minutes?"', { field: 'minutes_corrections', fieldLabel: 'Corrections noted' }),
      step('minutes_approved', 'Minutes approved', { hint: '"If there are no corrections, the minutes stand approved as read/corrected."' }),
    ],
  },
  {
    key: 'reports', title: 'Board / Officer Reports', list: 'reports',
    note: 'Reports are received, not voted on, unless a report contains a recommendation requiring action (record it under motions).',
    steps: [],
  },
  {
    key: 'old', title: 'Old Business (Unfinished Business)', list: 'old',
    note: 'Items carried over from previous meetings. Mark each one resolved or tabled; anything still open carries to the next agenda.',
    steps: [],
  },
  {
    key: 'new', title: 'New Business', list: 'new',
    note: 'Chair: "Is there any new business?" Member must be recognized, state the motion, and obtain a second.',
    steps: [],
  },
  {
    key: 'motions', title: 'Discussion, Motions & Votes', list: 'motions',
    note: 'Motion made → Seconded → Chair states the question → Debate → Chair puts the question → Vote (voice / show of hands / division) → Chair announces result.',
    steps: [],
  },
  {
    key: 'close_business', title: 'Announcements & Close of Business', list: 'announcement', listAfter: 'announcements',
    steps: [
      step('announcements', 'Announcements: nets, events, field day, special event stations, volunteer needs, etc.'),
      step('further_business', '"Is there any further business?" — confirm none'),
      step('recess', 'Motion to recess / adjourn business meeting and move to presentation', { general: true, field: 'recess_moved', fieldLabel: 'Moved / 2nd' }),
    ],
  },
  {
    key: 'presentation', title: 'Presentation', list: 'presentation', general: true,
    steps: [
      step('av_tested', 'Presenter confirmed & A/V (projector, laptop, audio) tested before meeting'),
      step('introduce', 'Introduce presenter and invite them up'),
      step('qa', 'Q&A / discussion following presentation'),
      step('thank', 'Thank presenter (gift / recognition / follow-up note if applicable)'),
    ],
  },
  {
    key: 'closing', title: 'Closing', list: 'next', listAfter: 'remind_next',
    steps: [
      step('remind_next', 'Remind members of next meeting'),
      step('closing_remarks', 'Closing remarks & thank attendees'),
      step('adjourn', 'Adjourn', { hint: '"There being no further business, the meeting is adjourned."', time: 'adjourned_at' }),
      step('notes_to_secretary', 'Notes handed to Secretary for the minutes'),
    ],
  },
];

export const templateKind = (meetingType) => (meetingType === 'board' ? 'board' : 'general');

/** The numbered sections and steps for a meeting type. */
export function agendaTemplate(meetingType) {
  const kind = templateKind(meetingType);
  const keep = (x) => kind === 'general' || !x.general;
  return {
    kind,
    sections: SECTIONS.filter(keep).map((s, i) => ({
      key: s.key, number: i + 1, title: s.title, list: s.list || null, listAfter: s.listAfter || null, note: s.note || null,
      steps: s.steps.filter(keep).map(({ general, ...rest }) => rest),
    })),
  };
}

export const stepKeys = (meetingType) =>
  new Set(agendaTemplate(meetingType).sections.flatMap(s => s.steps.map(st => st.key)));

// Officer report slots: one per officer position, then committee/other reports
export const REPORT_SLOTS = [...POSITIONS, { key: 'committee', label: 'Committee / other reports' }];
export const isReportKey = (key) => REPORT_SLOTS.some(r => r.key === key);

export const ITEM_SECTIONS = ['old', 'new', 'announcement'];
export const ITEM_STATUSES = ['open', 'resolved', 'tabled'];
export const MOTION_RESULTS = ['passed', 'failed', 'tabled', 'withdrawn'];

export const MAX_TEXT = 10000;

// Agenda fields officers can change, and what each one accepts
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIELD_RULES = {
  location: 'text', start_time: 'time', called_to_order: 'time', adjourned_at: 'time',
  presiding: 'text', secretary: 'text', quorum: 'flag',
  pledge_by: 'text', prayer_by: 'text', minutes_corrections: 'text',
  treasurer_begin: 'text', treasurer_end: 'text', discussion_notes: 'text', recess_moved: 'text',
  presentation_title: 'text', presenter_name: 'text', presenter_affiliation: 'text',
  presenter_contact: 'text', presentation_length: 'text', presentation_intro: 'text', presentation_notes: 'text',
  next_meeting_date: 'date', next_meeting_place: 'text', next_presenter: 'text',
};
export const AGENDA_FIELDS = Object.keys(FIELD_RULES);

/**
 * Check the agenda fields in `body`. Returns { values: { field: value } } with
 * blanks as null, or { error }. Keys that are not agenda fields are ignored.
 */
export function cleanAgendaFields(body) {
  const values = {};
  for (const field of AGENDA_FIELDS) {
    if (!(field in body)) continue;
    const raw = body[field];
    const rule = FIELD_RULES[field];
    if (rule === 'flag') {
      if (raw === null || raw === '') values[field] = null;
      else if (raw === true || raw === 1 || raw === '1') values[field] = 1;
      else if (raw === false || raw === 0 || raw === '0') values[field] = 0;
      else return { error: `${field} must be yes, no, or blank` };
      continue;
    }
    const text = raw === null || raw === undefined ? '' : String(raw).trim();
    if (text.length > MAX_TEXT) return { error: `${field} is too long` };
    if (text && rule === 'time' && !TIME.test(text)) return { error: `${field} must be a time like 19:00` };
    if (text && rule === 'date' && !DATE.test(text)) return { error: `${field} must be a date (YYYY-MM-DD)` };
    values[field] = text || null;
  }
  return { values };
}

/** "Name CALL" for an officer row, for the presiding/secretary defaults. */
export const officerLabel = (o) => (o ? [o.name, o.callsign].filter(Boolean).join(' ') : null);

/**
 * The agenda of the same meeting type held most recently before this one, or null.
 */
export function previousAgenda(env, meeting) {
  return env.DB.prepare(`
    SELECT a.id, m.id AS meeting_id, m.meeting_date
    FROM agendas a JOIN meetings m ON m.id = a.meeting_id
    WHERE m.meeting_type = ? AND m.meeting_date < ?
    ORDER BY m.meeting_date DESC, m.id DESC
    LIMIT 1
  `).bind(meeting.meeting_type, meeting.meeting_date).first();
}

/**
 * Copy business still open on the previous agenda into this agenda's old
 * business. Items already copied here are skipped, so it is safe to run again.
 * Returns how many were copied.
 */
export async function carryOpenItems(env, agendaId, meeting, userId) {
  const prev = await previousAgenda(env, meeting);
  if (!prev) return 0;
  const result = await env.DB.prepare(`
    INSERT INTO agenda_items (agenda_id, section, title, details, owner, carried_from_id, created_by)
    SELECT ?, 'old', i.title, i.details, i.owner, i.id, ?
    FROM agenda_items i
    WHERE i.agenda_id = ? AND i.section IN ('old', 'new') AND i.status = 'open'
      AND NOT EXISTS (SELECT 1 FROM agenda_items x WHERE x.agenda_id = ? AND x.carried_from_id = i.id)
    ORDER BY CASE i.section WHEN 'old' THEN 0 ELSE 1 END, i.id
  `).bind(agendaId, userId, prev.id, agendaId).run();
  return result.meta.changes || 0;
}

const cents = (n) => Math.round(Number(n || 0) * 100);

/**
 * Money received since the last meeting of the same type, through this
 * meeting's date: dues by paid date and monetary donations by donation date.
 * With no earlier meeting the period starts on January 1 of the meeting year.
 * Dues with no paid date are left out, since there is no way to place them.
 */
export async function incomeSinceLastMeeting(env, meeting) {
  const prev = await env.DB.prepare(`
    SELECT meeting_date FROM meetings
    WHERE meeting_type = ? AND meeting_date < ?
    ORDER BY meeting_date DESC LIMIT 1
  `).bind(meeting.meeting_type, meeting.meeting_date).first();

  const to = meeting.meeting_date;
  // Exclusive lower bound: the day of the last meeting was in its report
  const after = prev ? prev.meeting_date : `${Number(to.slice(0, 4)) - 1}-12-31`;

  const [dues, donations] = await env.DB.batch([
    env.DB.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(amount_paid), 0) AS total FROM memberships
      WHERE amount_paid > 0 AND paid_date IS NOT NULL
        AND substr(paid_date, 1, 10) > ? AND substr(paid_date, 1, 10) <= ?
    `).bind(after, to),
    env.DB.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM donations
      WHERE donation_kind = 'monetary' AND amount > 0
        AND substr(donation_date, 1, 10) > ? AND substr(donation_date, 1, 10) <= ?
    `).bind(after, to),
  ]);

  const d = dues.results[0], g = donations.results[0];
  return {
    since: prev ? prev.meeting_date : `${to.slice(0, 4)}-01-01`,
    since_last_meeting: !!prev,
    through: to,
    dues:      { count: d.count, total: cents(d.total) / 100 },
    donations: { count: g.count, total: cents(g.total) / 100 },
    total: (cents(d.total) + cents(g.total)) / 100,
  };
}
