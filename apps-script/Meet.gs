// YFJ attendance
// Pulls participants for every finished conference held in one Meet space
// within the last LOOKBACK_HOURS and writes one row per person to the attendance tab.
// Lives in the same project as Code.gs; run runAttendance manually or from a time-driven trigger.

const MEETING_CODE = 'qkg-zafv-wiy' // from the Meet URL
const ATTENDANCE_GID = 1336193348 // attendance tab's gid from the URL (#gid=...)
const LOOKBACK_HOURS = 24
const PRESENT_MIN_MINUTES = 10 // attendance rule: >= this many minutes = Present
const TZ = 'America/Edmonton'
const ATTENDANCE_HEADER = ['Date', 'Participant', 'First join', 'Last leave', 'Minutes', 'Sessions', 'Status', 'Conference ID']
const CONFERENCE_ID_COL = 8 // column of 'Conference ID' in ATTENDANCE_HEADER (1-based)

function runAttendance() {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000).toISOString()
  const filter = `space.meeting_code = "${MEETING_CODE}" AND start_time >= "${since}"`
  const records = meetGet_('conferenceRecords', { filter }).conferenceRecords || []

  if (records.length === 0) {
    Logger.log('No conference found. Did anyone join the meeting in the last ' + LOOKBACK_HOURS + 'h?')
    return
  }

  const sheet = getAttendanceSheet_()
  const done = recordedConferences_(sheet)
  let processed = 0

  records.forEach(rec => {
    // Skip meetings still in progress (minutes would be partial) and ones already written,
    // so re-running or a daily trigger never duplicates rows.
    if (!rec.endTime) {
      Logger.log('Skipping in-progress conference ' + rec.name)
      return
    }
    if (done.has(rec.name)) return

    // Meeting date = date the conference STARTED (handles 11:30 PM -> 12:30 AM)
    const meetingDate = Utilities.formatDate(new Date(rec.startTime), TZ, 'yyyy-MM-dd')
    const rows = listAll_(rec.name + '/participants', 'participants').map(p => {
      const sessions = listAll_(p.name + '/participantSessions', 'participantSessions')
      let totalMs = 0, firstJoin = null, lastLeave = null
      sessions.forEach(s => {
        const start = new Date(s.startTime)
        const end = s.endTime ? new Date(s.endTime) : new Date(rec.endTime)
        totalMs += end - start
        if (!firstJoin || start < firstJoin) firstJoin = start
        if (!lastLeave || end > lastLeave) lastLeave = end
      })
      const minutes = Math.round(totalMs / 60000)
      return [
        meetingDate,
        displayName_(p),
        firstJoin ? Utilities.formatDate(firstJoin, TZ, 'h:mm a') : '',
        lastLeave ? Utilities.formatDate(lastLeave, TZ, 'h:mm a') : '',
        minutes,
        sessions.length,
        minutes >= PRESENT_MIN_MINUTES ? 'Present' : 'Too short',
        rec.name,
      ]
    })

    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows)
    }
    processed++
  })
  Logger.log('Done. New conferences written: ' + processed)
}

function displayName_(p) {
  if (p.signedinUser) return p.signedinUser.displayName
  if (p.anonymousUser) return p.anonymousUser.displayName + ' (not signed in)'
  if (p.phoneUser) return p.phoneUser.displayName + ' (phone)'
  return 'Unknown'
}

function getAttendanceSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets().find(s => s.getSheetId() === ATTENDANCE_GID)
  if (!sheet) throw new Error('Attendance tab not found: ATTENDANCE_GID=' + ATTENDANCE_GID)
  if (sheet.getLastRow() === 0) sheet.appendRow(ATTENDANCE_HEADER)
  return sheet
}

// Conference IDs already in the sheet.
function recordedConferences_(sheet) {
  const last = sheet.getLastRow()
  if (last < 2) return new Set()
  return new Set(sheet.getRange(2, CONFERENCE_ID_COL, last - 1, 1).getValues().map(r => r[0]))
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
