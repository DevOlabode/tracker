// YFJ attendance
// Pulls participants for every finished conference held in one Meet space
// within the last LOOKBACK_HOURS, checks them against the core members tab,
// and writes one row per core member (Present, Absent or Excused) plus any guests to the attendance tab.
// Lives in the same project as Code.gs; run installNightlyTrigger once to run runAttendance every night,
// and createExcuseForm once to make the "can't make it" form whose answers mark people Excused.

const MEETING_CODE = 'hps-cndp-aos' // from the Meet URL
const ATTENDANCE_GID = 1336193348 // attendance tab's gid from the URL (#gid=...)
const MEMBERS_GID = 0 // members tab's gid, in the SPREADSHEET_ID spreadsheet (Code.gs)
const MEMBERS_NAME_HEADER = 'Name' // members tab header of the name column
const MEMBERS_TYPE_HEADER = 'Member Type' // members tab header of the member type column
const MEMBERS_ACTIVE_HEADER = 'Active?' // members tab header of the active column; FALSE/No rows are skipped
const MEMBERS_EMAIL_HEADER = 'Email' // optional: used to match Meet names like "johnsmith"
const MEMBERS_ALIAS_HEADER = 'Meet Name' // optional column: extra names someone uses in Meet, comma-separated
const CORE_TYPE = 'Core' // only members whose type starts with this word (e.g. "Core", "Core Member") are expected
const LOOKBACK_HOURS = 48 // safe to overlap: meetings already in the sheet are skipped
const PRESENT_MIN_MINUTES = 10 // attendance rule: >= this many minutes = Present
const MIN_CONFERENCE_MINUTES = 10 // meetings shorter than this in total (test calls) are ignored
const RESTART_GAP_MINUTES = 30 // a call restarted within this many minutes of the last one ending is the same meeting
const NIGHTLY_HOUR = 2 // hour (0-23, TZ) the nightly trigger runs; after the meeting has ended.
                       // Excuse forms sent before this hour count for the previous evening's meeting.
const TZ = 'America/Edmonton'
const ATTENDANCE_HEADER = ['Meeting Start', 'Member', 'Join Time', 'Leave Time', 'Duration (min)', 'Status']
const NIL = '-' // filler for an absent member's time fields
const STATUS_ORDER = { Present: 0, Guest: 1, Excused: 2, Absent: 3 }
const STATUS_COL = 6 // column of 'Status' in ATTENDANCE_HEADER (1-based)
const STATUS_CHOICES = ['Present', 'Absent', 'Excused', 'Guest'] // dropdown, so statuses can still be changed by hand
const EXCUSE_FORM_TITLE = "YFJ prayer line: can't make it"
const EXCUSE_Q_NAME = 'Your name'
const EXCUSE_Q_TYPE = 'When?'
const TYPE_TODAY = 'Just today'
const TYPE_DAYS = 'A day or a few days in a row'
const TYPE_WEEKLY = 'Same days every week, for the next 3 months'
const EXCUSE_Q_FROM = 'From'
const EXCUSE_Q_TO = 'Until'
const EXCUSE_Q_WEEKLY_DAYS = 'Which days every week?'
const WEEKLY_MONTHS = 3 // a weekly excuse lasts this long from the day it's filled in
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] // getUTCDay() order
const EXCUSE_FORM_ID_PROP = 'EXCUSE_FORM_ID' // script property holding the form's id, set by createExcuseForm

function runAttendance() {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString()
  const filter = `space.meeting_code = "${MEETING_CODE}" AND start_time >= "${since}"`
  const records = meetGet_('conferenceRecords', { filter }).conferenceRecords || []

  if (records.length === 0) {
    Logger.log('No conference found. Did anyone join the meeting in the last ' + LOOKBACK_HOURS + 'h?')
    return
  }

  const sheet = getAttendanceSheet_()
  const members = getMembers_()
  syncExcuseFormNames_(members)
  const excuses = getExcuses_()
  const done = recordedMeetings_(sheet)
  let processed = 0

  meetings_(records).forEach(({ start: meetingStart, recs }) => {
    // Skip meetings already written, so re-running or a nightly trigger never duplicates rows.
    if (done.has(meetingStart)) {
      Logger.log('Already in the sheet: meeting started ' + meetingStart)
      return
    }

    const attended = attendance_(recs)
    const matched = matchMembers_(members, Object.keys(attended).map(key => attended[key]))
    const rows = []

    const meetingDay = meetingStart.slice(0, 10) // yyyy-MM-dd
    members.forEach((member, i) => {
      const a = matched.get(i)
      // Not present but filled in the form for this day -> Excused. Showing up always wins.
      const missed = isExcused_(excuses, member.name, meetingDay) ? 'Excused' : 'Absent'
      if (a) {
        // Members who joined but stayed under the rule are Absent, with their times kept as proof.
        const status = a.minutes >= PRESENT_MIN_MINUTES ? 'Present' : missed
        rows.push([meetingStart, member.name, a.join, a.leave, a.minutes, status])
      } else {
        rows.push([meetingStart, member.name, NIL, NIL, NIL, missed])
      }
    })

    // Anyone on the call who couldn't be matched to a core member, however briefly.
    const matchedAttendees = new Set(matched.values())
    Object.keys(attended).forEach(key => {
      const a = attended[key]
      if (matchedAttendees.has(a)) return
      rows.push([meetingStart, a.name, a.join, a.leave, a.minutes, 'Guest'])
    })

    // By status, then (within Excused/Absent) those who joined briefly before those who never joined, then by name.
    const neverJoined = row => row[2] === NIL ? 1 : 0
    rows.sort((x, y) => STATUS_ORDER[x[5]] - STATUS_ORDER[y[5]] || neverJoined(x) - neverJoined(y) || x[1].localeCompare(y[1]))

    if (rows.length) {
      // Leave one blank row between meetings (none right under the header).
      const lastRow = sheet.getLastRow()
      const firstRow = lastRow + (lastRow > 1 ? 2 : 1)
      // Plain text keeps Meeting Start, Join Time and Leave Time as "2026-10-07 11:28 PM" / "9:15 PM";
      // otherwise Sheets turns them into 24h date/time values.
      ;[1, 3, 4].forEach(col => sheet.getRange(firstRow, col, rows.length, 1).setNumberFormat('@'))
      sheet.getRange(firstRow, 1, rows.length, rows[0].length).setValues(rows)
      sheet.getRange(firstRow, STATUS_COL, rows.length, 1).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(STATUS_CHOICES, true).build())
    }
    processed++
  })
  Logger.log('Done. New meetings written: ' + processed)
}

// Groups conference records into meetings. If the call ends by accident and is restarted
// within RESTART_GAP_MINUTES, Meet creates a new conference; those are joined back into
// one meeting so everyone's time across both adds up. Meetings still in progress or
// shorter than MIN_CONFERENCE_MINUTES (test calls) are left out.
// Returns [{ start: 'yyyy-MM-dd h:mm a', recs: [conference records] }].
function meetings_(records) {
  const groups = []
  records
    .slice()
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
    .forEach(rec => {
      const start = new Date(rec.startTime)
      const end = rec.endTime ? new Date(rec.endTime) : new Date()
      const last = groups[groups.length - 1]
      if (last && start - last.end <= RESTART_GAP_MINUTES * 60000) {
        last.recs.push(rec)
        if (end > last.end) last.end = end
      } else {
        groups.push({ recs: [rec], start, end })
      }
    })

  return groups.filter(g => {
    const label = Utilities.formatDate(g.start, TZ, 'yyyy-MM-dd h:mm a')
    const minutes = Math.round((g.end - g.start) / 60000)
    if (g.recs.some(rec => !rec.endTime)) {
      Logger.log('Skipping meeting still in progress, started ' + label)
      return false
    }
    if (minutes < MIN_CONFERENCE_MINUTES) {
      Logger.log('Skipping short call (test call?) started ' + label + ', ' + minutes + ' min')
      return false
    }
    if (g.recs.length > 1) Logger.log('Meeting started ' + label + ' was restarted; combining ' + g.recs.length + ' calls')
    return true
  }).map(g => ({ start: Utilities.formatDate(g.start, TZ, 'yyyy-MM-dd h:mm a'), recs: g.recs }))
}

// Run once from the editor: creates the "can't make it" form, saves its answers to a new
// tab in the spreadsheet, and logs the link to share (e.g. pinned in the WhatsApp group).
// Running it again just logs the link of the existing form.
function createExcuseForm() {
  const existing = getExcuseForm_()
  if (existing) {
    Logger.log('Form already exists. Share this link: ' + existing.getPublishedUrl())
    return
  }
  const form = FormApp.create(EXCUSE_FORM_TITLE)
    .setDescription("Can't join the prayer line? Pick your name and when you'll be away.")
    .setConfirmationMessage("Thanks, you're marked as excused.")
  form.addListItem().setTitle(EXCUSE_Q_NAME).setRequired(true)
  const type = form.addMultipleChoiceItem().setTitle(EXCUSE_Q_TYPE).setRequired(true)

  // "Just today" submits straight away; the other two each get one more page, which submits when done.
  const days = form.addPageBreakItem().setTitle(TYPE_DAYS)
  form.addDateItem().setTitle(EXCUSE_Q_FROM).setRequired(true)
  form.addDateItem().setTitle(EXCUSE_Q_TO).setHelpText('Leave blank if it is just one day.')

  const weekly = form.addPageBreakItem().setTitle(TYPE_WEEKLY).setGoToPage(FormApp.PageNavigationType.SUBMIT)
    .setHelpText('For regular conflicts, like early mornings. Counts for ' + WEEKLY_MONTHS +
      ' months from today; fill it in again after that.')
  form.addCheckboxItem().setTitle(EXCUSE_Q_WEEKLY_DAYS).setRequired(true)
    .setChoiceValues(WEEKDAYS.slice(1).concat(WEEKDAYS[0])) // Monday first

  type.setChoices([
    type.createChoice(TYPE_TODAY, FormApp.PageNavigationType.SUBMIT),
    type.createChoice(TYPE_DAYS, days),
    type.createChoice(TYPE_WEEKLY, weekly),
  ])

  form.setDestination(FormApp.DestinationType.SPREADSHEET, SPREADSHEET_ID)
  PropertiesService.getScriptProperties().setProperty(EXCUSE_FORM_ID_PROP, form.getId())
  syncExcuseFormNames_(getMembers_())
  Logger.log('Form created. Share this link: ' + form.getPublishedUrl())
  Logger.log('Edit it here: ' + form.getEditUrl())
}

function getExcuseForm_() {
  const id = PropertiesService.getScriptProperties().getProperty(EXCUSE_FORM_ID_PROP)
  if (!id) return null
  try {
    return FormApp.openById(id)
  } catch (err) {
    Logger.log('Excuse form ' + id + ' could not be opened (deleted?): ' + err.message)
    return null
  }
}

// Keeps the form's name dropdown equal to the current core members.
function syncExcuseFormNames_(members) {
  const form = getExcuseForm_()
  if (!form) return
  const item = form.getItems(FormApp.ItemType.LIST).find(it => it.getTitle() === EXCUSE_Q_NAME)
  if (!item) return
  const names = members.map(m => m.name).sort((a, b) => a.localeCompare(b))
  const list = item.asListItem()
  const current = list.getChoices().map(c => c.getValue())
  if (current.join('\n') !== names.join('\n')) list.setChoiceValues(names)
}

// Excuses from the form's responses tab:
// [{ name, from: 'yyyy-MM-dd', to: 'yyyy-MM-dd', days: [0-6] or null (every day in the range) }].
// "Just today" is the day it was sent; weekly runs WEEKLY_MONTHS from that day.
// Read from the tab (not the form) so a wrong entry can be fixed or deleted there by hand.
function getExcuses_() {
  const form = getExcuseForm_()
  if (!form) return []
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
  const sheet = ss.getSheets().find(s => {
    const url = s.getFormUrl()
    if (!url) return false
    try {
      return FormApp.openByUrl(url).getId() === form.getId()
    } catch (err) {
      return false
    }
  })
  if (!sheet || sheet.getLastRow() < 2) return []
  const values = sheet.getDataRange().getValues()
  const header = values[0].map(normalize_)
  const col = title => header.indexOf(normalize_(title))
  const get = (r, title) => col(title) < 0 ? '' : r[col(title)]
  const tz = ss.getSpreadsheetTimeZone()
  const day = v => v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : ''
  // The day a form was sent, where a "day" runs from one nightly run to the next: sent at 1 AM,
  // before the 2 AM run, it belongs to the meeting that started the evening before.
  const sentDay = v => v instanceof Date
    ? Utilities.formatDate(new Date(v.getTime() - NIGHTLY_HOUR * 3600 * 1000), TZ, 'yyyy-MM-dd') : ''
  const weekdays = v => String(v).split(',').map(d => WEEKDAYS.indexOf(d.trim())).filter(i => i >= 0)

  const excuses = []
  values.slice(1).forEach(r => {
    const name = String(get(r, EXCUSE_Q_NAME)).trim()
    const filled = sentDay(r[0]) // from the Timestamp column
    const type = String(get(r, EXCUSE_Q_TYPE)).trim()
    if (!name || !filled) return
    if (type === TYPE_TODAY) {
      excuses.push({ name, from: filled, to: filled, days: null })
    } else if (type === TYPE_DAYS) {
      let from = day(get(r, EXCUSE_Q_FROM))
      let to = day(get(r, EXCUSE_Q_TO)) || from
      if (to < from) [from, to] = [to, from]
      if (from) excuses.push({ name, from, to, days: null })
    } else if (type === TYPE_WEEKLY) {
      const ws = weekdays(get(r, EXCUSE_Q_WEEKLY_DAYS))
      if (ws.length) excuses.push({ name, from: filled, to: addMonths_(filled, WEEKLY_MONTHS), days: ws })
    }
  })
  return excuses
}

function addMonths_(isoDay, n) {
  const d = new Date(isoDay + 'T12:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

function isExcused_(excuses, name, day) {
  const weekday = new Date(day + 'T12:00:00Z').getUTCDay()
  return excuses.some(e => normalize_(e.name) === normalize_(name) &&
    e.from <= day && day <= e.to && (e.days === null || e.days.includes(weekday)))
}

// Run once from the editor: runs runAttendance every night at NIGHTLY_HOUR.
function installNightlyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runAttendance')
    .forEach(t => ScriptApp.deleteTrigger(t))
  ScriptApp.newTrigger('runAttendance').timeBased().everyDays(1).atHour(NIGHTLY_HOUR).inTimezone(TZ).create()
  Logger.log('Nightly trigger set for ' + NIGHTLY_HOUR + ':00 ' + TZ)
}

// Per-person attendance across one meeting's conferences, keyed by normalized name.
// Join/leave intervals are grouped by name and overlapping ones merged, so time on
// two devices at once isn't doubled, while separate visits (left and rejoined) add up.
function attendance_(recs) {
  const byName = {}
  recs.forEach(rec => {
    listAll_(rec.name + '/participants', 'participants').forEach(p => {
      const name = displayName_(p)
      const entry = byName[normalize_(name)] || (byName[normalize_(name)] = { name, intervals: [] })
      listAll_(p.name + '/participantSessions', 'participantSessions').forEach(s => {
        entry.intervals.push([new Date(s.startTime), s.endTime ? new Date(s.endTime) : new Date(rec.endTime)])
      })
    })
  })

  const out = {}
  Object.keys(byName).forEach(key => {
    const intervals = byName[key].intervals.sort((a, b) => a[0] - b[0])
    if (!intervals.length) return
    let totalMs = 0, curStart = intervals[0][0], curEnd = intervals[0][1]
    intervals.slice(1).forEach(([start, end]) => {
      if (start <= curEnd) {
        if (end > curEnd) curEnd = end
      } else {
        totalMs += curEnd - curStart
        curStart = start
        curEnd = end
      }
    })
    totalMs += curEnd - curStart
    out[key] = {
      name: byName[key].name,
      join: Utilities.formatDate(intervals[0][0], TZ, 'h:mm a'),
      leave: Utilities.formatDate(curEnd, TZ, 'h:mm a'), // merged intervals are sorted, so curEnd is the last leave
      minutes: Math.round(totalMs / 60000),
    }
  })
  return out
}

// Pairs core members with Meet attendees, from strictest rule to loosest.
// A pair is only accepted when it's unambiguous (one candidate each way), so
// "Smith" alone never gets credited to either Jane or John Smith,
// and an ambiguous name like that doesn't stop the others from matching.
// Returns Map(member index -> attendee).
function matchMembers_(members, attendees) {
  const matched = new Map()
  const taken = new Set()
  const rules = [
    // Same name, ignoring case, accents and punctuation; or a listed Meet Name.
    (m, a) => [m.name].concat(m.aliases).some(n => loose_(n) === loose_(a.name)),
    // Same words in a different order, or written without spaces ("Mary Jones" / "MaryJones").
    (m, a) => sameWords_(m.name, a.name) || compact_(m.name) === compact_(a.name),
    // Every word of the shorter name matches a word of the longer one, allowing
    // short forms and small typos ("Tom" / "Tom Brown", "Sam" / "Samuel", "Jonathon" / "Jonathan").
    (m, a) => wordsCovered_(a.name, m.name) || wordsCovered_(m.name, a.name),
    // Same first name and a surname spelled differently but close: sounds alike
    // ("Philips" / "Filips") or mostly the same start ("Hendricks" / "Hendrikson").
    (m, a) => similarNames_(m.name, a.name),
    // Meet name matches the email before the @ ("John S" / "john.smith@gmail.com").
    (m, a) => emailMatches_(m.email, a.name),
  ]

  rules.forEach(rule => {
    const single = new Map() // attendee -> the one member passing this rule
    const counts = new Map() // member index -> number of such attendees pointing at it
    attendees.forEach(a => {
      if (taken.has(a)) return
      const ms = members.map((m, i) => i).filter(i => !matched.has(i) && rule(members[i], a))
      if (ms.length !== 1) return
      single.set(a, ms[0])
      counts.set(ms[0], (counts.get(ms[0]) || 0) + 1)
    })
    single.forEach((i, a) => {
      if (counts.get(i) !== 1) return
      matched.set(i, a)
      taken.add(a)
    })
  })
  return matched
}

// Lowercase, accents and punctuation removed, single spaces: "Zoë-Ann  B." -> "zoe ann b"
function loose_(name) {
  return String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function words_(name) {
  return loose_(name).split(' ').filter(Boolean)
}

function compact_(name) {
  return loose_(name).replace(/ /g, '')
}

function sameWords_(x, y) {
  const a = words_(x).sort().join(' '), b = words_(y).sort().join(' ')
  return a !== '' && a === b
}

// True when every word of `short` matches a different word of `long`
// (at least one of them a real word, not just an initial).
function wordsCovered_(short, long) {
  const s = words_(short), l = words_(long)
  if (!s.some(w => w.length >= 3) || s.length > l.length) return false
  const used = new Set()
  return s.every(w => {
    const i = l.findIndex((v, j) => !used.has(j) && wordsMatch_(w, v))
    if (i < 0) return false
    used.add(i)
    return true
  })
}

// Same word, an initial ("S" / "Smith"), one is a 3+ letter start of the other
// ("Sam" / "Samuel"), or a one-letter typo in a 5+ letter word.
function wordsMatch_(x, y) {
  if (x === y) return true
  const [a, b] = x.length <= y.length ? [x, y] : [y, x]
  if ((a.length === 1 || a.length >= 3) && b.startsWith(a)) return true
  return a.length >= 5 && editDistance_(a, b) <= 1
}

function similarNames_(x, y) {
  const wx = words_(x), wy = words_(y)
  if (wx.length < 2 || wy.length < 2) return false
  return wordsMatch_(wx[0], wy[0]) && surnamesClose_(wx[wx.length - 1], wy[wy.length - 1])
}

// Close enough after evening out common spelling swaps (ph/f, ck/k, y/i, doubled letters):
// equal, a 1-2 letter slip in a longer name, or sharing a 5+ letter start that is most of the name.
// "Wilson" / "Wilkins" share only "Wil", so they stay different people.
function surnamesClose_(a, b) {
  const sound = w => w.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/y/g, 'i').replace(/(.)\1+/g, '$1')
  const sa = sound(a), sb = sound(b)
  if (sa === sb) return true
  const shorter = Math.min(sa.length, sb.length)
  if (editDistance_(sa, sb) <= (shorter >= 6 ? 2 : 1)) return true
  let prefix = 0
  while (prefix < shorter && sa[prefix] === sb[prefix]) prefix++
  return prefix >= 5 && prefix >= shorter * 0.6
}

function editDistance_(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

// Meet name vs the part of the email before @, digits dropped. Either the whole
// thing matches ("johnsmith" / "john.smith22@gmail.com"), or the name has one
// word per email part ("John S" / "john.smith@..."), so a lone surname doesn't count.
function emailMatches_(email, name) {
  const local = String(email || '').split('@')[0].toLowerCase()
  const parts = local.split(/[^a-z]+/).filter(Boolean)
  if (!parts.length) return false
  if (parts.join('') === compact_(name)) return true
  return parts.length > 1 && words_(name).length === parts.length && wordsCovered_(name, parts.join(' '))
}

function displayName_(p) {
  const user = p.signedinUser || p.anonymousUser || p.phoneUser
  return (user && user.displayName) || 'Unknown'
}

// Case- and spacing-insensitive text, for comparing headers and names.
function normalize_(name) {
  return String(name).trim().replace(/\s+/g, ' ').toLowerCase()
}

function getAttendanceSheet_() {
  const sheet = getSheetByGid_(ATTENDANCE_GID, 'Attendance')
  // Keep row 1 in sync with the columns we write.
  sheet.getRange(1, 1, 1, ATTENDANCE_HEADER.length).setValues([ATTENDANCE_HEADER])
  return sheet
}

// Run from the editor to see who the script counts as core (with sheet row numbers) and who it leaves out.
function checkCoreMembers() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheets().find(s => s.getSheetId() === MEMBERS_GID)
  if (!sheet) throw new Error('Members tab not found: gid=' + MEMBERS_GID)
  const values = sheet.getDataRange().getValues()
  const header = values[0].map(normalize_)
  const nameCol = header.indexOf(normalize_(MEMBERS_NAME_HEADER))
  const typeCol = header.indexOf(normalize_(MEMBERS_TYPE_HEADER))
  Logger.log('Reading "' + sheet.getName() + '" in ' + sheet.getParent().getName())
  const core = getMembers_().map(m => normalize_(m.name))
  values.slice(1).forEach((r, i) => {
    const name = String(r[nameCol]).trim()
    if (!name) return
    Logger.log((core.includes(normalize_(name)) ? 'CORE      ' : 'left out  ') +
      'row ' + (i + 2) + ': ' + name + ' (' + String(r[typeCol]).trim() + ')')
  })
}

// Core members (name, email, Meet aliases) from the members tab, found by header so columns can move.
function getMembers_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheets().find(s => s.getSheetId() === MEMBERS_GID)
  if (!sheet) throw new Error('Members tab not found: gid=' + MEMBERS_GID)
  const values = sheet.getDataRange().getValues()
  const header = values[0].map(normalize_)
  const nameCol = header.indexOf(normalize_(MEMBERS_NAME_HEADER))
  const typeCol = header.indexOf(normalize_(MEMBERS_TYPE_HEADER))
  const activeCol = header.indexOf(normalize_(MEMBERS_ACTIVE_HEADER)) // optional
  const emailCol = header.indexOf(normalize_(MEMBERS_EMAIL_HEADER)) // optional
  const aliasCol = header.indexOf(normalize_(MEMBERS_ALIAS_HEADER)) // optional
  if (nameCol < 0 || typeCol < 0) {
    throw new Error('Members tab needs "' + MEMBERS_NAME_HEADER + '" and "' + MEMBERS_TYPE_HEADER + '" headers in row 1')
  }
  const seen = new Set()
  const members = values.slice(1)
    .filter(r => words_(r[typeCol])[0] === loose_(CORE_TYPE))
    .filter(r => activeCol < 0 || !['false', 'no', 'n', 'inactive'].includes(normalize_(r[activeCol])))
    .map(r => ({
      name: String(r[nameCol]).trim(),
      email: emailCol < 0 ? '' : String(r[emailCol]).trim(),
      aliases: aliasCol < 0 ? [] : String(r[aliasCol]).split(',').map(x => x.trim()).filter(Boolean),
    }))
    .filter(m => m.name && !seen.has(normalize_(m.name)) && seen.add(normalize_(m.name)))
  if (!members.length) {
    const types = [...new Set(values.slice(1).map(r => String(r[typeCol]).trim()).filter(Boolean))]
    throw new Error('No active "' + CORE_TYPE + '" members found on the members tab. Member Type values seen: ' +
      (types.join(', ') || '(none)'))
  }
  return members
}

function getSheetByGid_(gid, label) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets().find(s => s.getSheetId() === gid)
  if (!sheet) throw new Error(label + ' tab not found: gid=' + gid)
  return sheet
}

// Meeting Start values already in the sheet.
function recordedMeetings_(sheet) {
  const last = sheet.getLastRow()
  if (last < 2) return new Set()
  return new Set(sheet.getRange(2, 1, last - 1, 1).getDisplayValues().map(r => r[0]).filter(Boolean))
}

function listAll_(path, key) {
  let out = [], pageToken
  do {
    const res = meetGet_(path, pageToken ? { pageToken } : {})
    out = out.concat(res[key] || [])
    pageToken = res.nextPageToken
  } while (pageToken)
  return out
}

function meetGet_(path, params) {
  const qs = Object.keys(params || {})
    .map(k => k + '=' + encodeURIComponent(params[k])).join('&')
  const url = 'https://meet.googleapis.com/v2/' + path + (qs ? '?' + qs : '')
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  })
  if (res.getResponseCode() !== 200) {
    throw new Error('Meet API ' + res.getResponseCode() + ': ' + res.getContentText())
  }
  return JSON.parse(res.getContentText())
}
