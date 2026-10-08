// YFJ attendance
// Pulls participants for every finished conference held in one Meet space
// within the last LOOKBACK_HOURS, checks them against the core members tab,
// and writes one row per core member (Present or Absent) plus any guests to the attendance tab.
// Lives in the same project as Code.gs; run installNightlyTrigger once to run runAttendance every night.

const MEETING_CODE = 'hps-cndp-aos' // from the Meet URL
const ATTENDANCE_GID = 1336193348 // attendance tab's gid from the URL (#gid=...)
const MEMBERS_GID = 0 // members tab's gid, in the SPREADSHEET_ID spreadsheet (Code.gs)
const MEMBERS_NAME_HEADER = 'Name' // members tab header of the name column
const MEMBERS_TYPE_HEADER = 'Member Type' // members tab header of the member type column
const MEMBERS_ACTIVE_HEADER = 'Active?' // members tab header of the active column; FALSE/No rows are skipped
const MEMBERS_EMAIL_HEADER = 'Email' // optional: used to match Meet names like "dammyedekere"
const MEMBERS_ALIAS_HEADER = 'Meet Name' // optional column: extra names someone uses in Meet, comma-separated
const CORE_TYPE = 'Core' // only members whose type starts with this word (e.g. "Core", "Core Member") are expected
const LOOKBACK_HOURS = 48 // safe to overlap: meetings already in the sheet are skipped
const PRESENT_MIN_MINUTES = 10 // attendance rule: >= this many minutes = Present
const MIN_CONFERENCE_MINUTES = 10 // conferences shorter than this (test calls) are ignored
const NIGHTLY_HOUR = 2 // hour (0-23, TZ) the nightly trigger runs; after the meeting has ended
const TZ = 'America/Edmonton'
const ATTENDANCE_HEADER = ['Date', 'Meeting', 'Member', 'Join Time', 'Leave Time', 'Duration (min)', 'Sessions', 'Status', 'Joined As']
const NIL = '-' // filler for an absent member's time fields
const STATUS_ORDER = { Present: 0, Guest: 1, Absent: 2 }

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
  const done = recordedMeetings_(sheet)
  let processed = 0

  records.forEach(rec => {
    // Skip meetings still in progress (minutes would be partial) and ones already written,
    // so re-running or a nightly trigger never duplicates rows.
    if (!rec.endTime) {
      Logger.log('Skipping in-progress conference ' + rec.name)
      return
    }

    const confStart = new Date(rec.startTime)
    const confMinutes = Math.round((new Date(rec.endTime) - confStart) / 60000)
    if (confMinutes < MIN_CONFERENCE_MINUTES) {
      Logger.log('Skipping short conference (test call?) started ' +
        Utilities.formatDate(confStart, TZ, 'yyyy-MM-dd h:mm a') + ', ' + confMinutes + ' min')
      return
    }

    // Meeting date = date the conference STARTED (handles 11:30 PM -> 12:30 AM)
    const meetingDate = Utilities.formatDate(confStart, TZ, 'yyyy-MM-dd')
    const meetingStart = Utilities.formatDate(confStart, TZ, 'h:mm a')
    if (done.has(meetingDate + '|' + meetingStart)) {
      Logger.log('Already in the sheet: meeting started ' + meetingDate + ' ' + meetingStart)
      return
    }

    const attended = attendance_(rec)
    const matched = matchMembers_(members, Object.keys(attended).map(key => attended[key]))
    const rows = []

    members.forEach((member, i) => {
      const a = matched.get(i)
      if (a && a.minutes >= PRESENT_MIN_MINUTES) {
        // "Joined As" shows the Meet name only when it differs, so loose matches are easy to check.
        const joinedAs = normalize_(a.name) === normalize_(member.name) ? '' : a.name
        rows.push([meetingDate, meetingStart, member.name, a.join, a.leave, a.minutes, a.sessions, 'Present', joinedAs])
      } else {
        rows.push([meetingDate, meetingStart, member.name, NIL, NIL, NIL, NIL, 'Absent', ''])
      }
    })

    // Anyone on the call who couldn't be matched to a core member.
    const matchedAttendees = new Set(matched.values())
    Object.keys(attended).forEach(key => {
      const a = attended[key]
      if (matchedAttendees.has(a) || a.minutes < PRESENT_MIN_MINUTES) return
      rows.push([meetingDate, meetingStart, a.name, a.join, a.leave, a.minutes, a.sessions, 'Guest', a.name])
    })

    rows.sort((x, y) => STATUS_ORDER[x[7]] - STATUS_ORDER[y[7]] || x[2].localeCompare(y[2]))

    if (rows.length) {
      const firstRow = sheet.getLastRow() + 1
      // Plain text keeps the time columns (Meeting, Join Time, Leave Time) as "9:15 PM";
      // otherwise Sheets turns them into 24h time values.
      ;[2, 4, 5].forEach(col => sheet.getRange(firstRow, col, rows.length, 1).setNumberFormat('@'))
      sheet.getRange(firstRow, 1, rows.length, rows[0].length).setValues(rows)
    }
    processed++
  })
  Logger.log('Done. New meetings written: ' + processed)
}

// Run once from the editor: runs runAttendance every night at NIGHTLY_HOUR.
function installNightlyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runAttendance')
    .forEach(t => ScriptApp.deleteTrigger(t))
  ScriptApp.newTrigger('runAttendance').timeBased().everyDays(1).atHour(NIGHTLY_HOUR).inTimezone(TZ).create()
  Logger.log('Nightly trigger set for ' + NIGHTLY_HOUR + ':00 ' + TZ)
}

// Per-person attendance for one conference, keyed by normalized name.
// Join/leave intervals are grouped by name and overlapping ones merged,
// so two devices at once count as one session and their time isn't doubled.
function attendance_(rec) {
  const byName = {}
  listAll_(rec.name + '/participants', 'participants').forEach(p => {
    const name = displayName_(p)
    const entry = byName[normalize_(name)] || (byName[normalize_(name)] = { name, intervals: [] })
    listAll_(p.name + '/participantSessions', 'participantSessions').forEach(s => {
      entry.intervals.push([new Date(s.startTime), s.endTime ? new Date(s.endTime) : new Date(rec.endTime)])
    })
  })

  const out = {}
  Object.keys(byName).forEach(key => {
    const intervals = byName[key].intervals.sort((a, b) => a[0] - b[0])
    if (!intervals.length) return
    let totalMs = 0, sessions = 1, curStart = intervals[0][0], curEnd = intervals[0][1]
    intervals.slice(1).forEach(([start, end]) => {
      if (start <= curEnd) {
        if (end > curEnd) curEnd = end
      } else {
        totalMs += curEnd - curStart
        sessions++
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
      sessions,
    }
  })
  return out
}

// Pairs core members with Meet attendees, from strictest rule to loosest.
// A pair is only accepted when it's unambiguous (one candidate each way), so
// "Edekere" alone never gets credited to either Dammy or Precious Edekere,
// and an ambiguous name like that doesn't stop the others from matching.
// Returns Map(member index -> attendee).
function matchMembers_(members, attendees) {
  const matched = new Map()
  const taken = new Set()
  const rules = [
    // Same name, ignoring case, accents and punctuation; or a listed Meet Name.
    (m, a) => [m.name].concat(m.aliases).some(n => loose_(n) === loose_(a.name)),
    // Same words in a different order, or written without spaces ("Ayo Sunmola" / "AyoSunmola").
    (m, a) => sameWords_(m.name, a.name) || compact_(m.name) === compact_(a.name),
    // Every word of the shorter name matches a word of the longer one, allowing
    // short forms and small typos ("Oba" / "Oba Adeyemi", "Ayo" / "Ayomide", "Precius" / "Precious").
    (m, a) => wordsCovered_(a.name, m.name) || wordsCovered_(m.name, a.name),
    // Meet name matches the email before the @ ("Dammy E" / "dammy.edekere@gmail.com").
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

// Lowercase, accents and punctuation removed, single spaces: "Adé-Ola  O." -> "ade ola o"
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

// Same word, an initial ("E" / "Edekere"), one is a 3+ letter start of the other
// ("Ayo" / "Ayomide"), or a one-letter typo in a 5+ letter word.
function wordsMatch_(x, y) {
  if (x === y) return true
  const [a, b] = x.length <= y.length ? [x, y] : [y, x]
  if ((a.length === 1 || a.length >= 3) && b.startsWith(a)) return true
  return a.length >= 5 && editDistance_(a, b) <= 1
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
// thing matches ("dammyedekere" / "dammy.edekere22@gmail.com"), or the name has one
// word per email part ("Dammy E" / "dammy.edekere@..."), so a lone surname doesn't count.
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

// "date|meeting start" keys of meetings already in the sheet.
function recordedMeetings_(sheet) {
  const last = sheet.getLastRow()
  if (last < 2) return new Set()
  return new Set(sheet.getRange(2, 1, last - 1, 2).getDisplayValues().map(r => normalizeDate_(r[0]) + '|' + r[1]))
}

// Sheets may display the Date column in its own format; bring it back to yyyy-MM-dd.
function normalizeDate_(text) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const d = new Date(text)
  return isNaN(d) ? text : Utilities.formatDate(d, TZ, 'yyyy-MM-dd')
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
