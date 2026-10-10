const SPREADSHEET_ID = '1v1a-lJpxiyhObaMj52eAj-_DX57CPgYD14Z9_zgXWUQ'
const SHEET_GID = 436098174 // the tab's gid from the URL (#gid=...)
const MEMBERS_ID_HEADER = 'Member ID' // members tab column used as each person's id on the webpage
const SEARCH_MIN_CHARS = 3 // letters needed before the name search returns anything
const SEARCH_MAX_RESULTS = 5 // the webpage never gets more names than this per search

// Name search for the webpage. Returns only a few matches, labelled "First L.", so the
// full member list (and full names) never reach the browser. Reads the members tab
// (MEMBERS_GID etc. in Meet.gs) live, so new members are searchable right away.
function doGet(e) {
  const params = (e && e.parameter) || {}
  if (params.action === 'searchMembers') {
    return jsonResponse({ success: true, members: searchMembers_(params.q || '') })
  }
  return jsonResponse({ success: false, message: 'Unknown action.' })
}

function doPost(e) {
  try {
    console.log('doPost received: ' + (e && e.postData && e.postData.contents))

    const data = JSON.parse(e.postData.contents)
    const { type, location, date } = data
    let name = data.name

    // The webpage sends member ids from the name search; save their full names.
    if (Array.isArray(data.memberIds)) {
      const byId = new Map(memberDirectory_().map(m => [m.id, m.name]))
      const names = data.memberIds.map(id => byId.get(String(id)))
      if (!names.length || names.some(n => !n)) {
        console.error('Unknown member ids: ' + JSON.stringify(data.memberIds))
        return jsonResponse({ success: false, message: 'Some names were not found. Please search for them again.' })
      }
      name = names.join(', ')
    }

    if (type !== 'Individual' && type !== 'Group') {
      console.error('Validation failed: bad type ' + type)
      return jsonResponse({ success: false, message: 'type must be "Individual" or "Group".' })
    }
    if (!name || !location || !date) {
      console.error('Validation failed: ' + JSON.stringify({ type, name, location, date }))
      return jsonResponse({ success: false, message: 'name, location, and date are required.' })
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID)
    const sheet = ss.getSheets().find(s => s.getSheetId() === SHEET_GID)

    if (!sheet) {
      console.error('Sheet not found: SHEET_GID=' + SHEET_GID)
      return jsonResponse({ success: false, message: 'Target sheet/tab not found.' })
    }

    sheet.appendRow([type, name, location, date])
    console.log('Row appended for ' + type + ': ' + name)

    return jsonResponse({ success: true, message: 'Submission saved successfully' })
  } catch (err) {
    console.error('doPost error: ' + err.message + '\n' + err.stack)
    return jsonResponse({ success: false, message: 'Something went wrong: ' + err.message })
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}

function searchMembers_(query) {
  const qWords = words_(query)
  if (qWords.join('').length < SEARCH_MIN_CHARS) return []
  // Every typed word must start one of the name's words: "jan", "jane s" and "smi" all find "Jane Smith".
  return memberDirectory_()
    .filter(m => qWords.every(q => m.words.some(w => w.startsWith(q))))
    .sort((a, b) => Number(!b.words[0].startsWith(qWords[0])) - Number(!a.words[0].startsWith(qWords[0])) ||
      a.label.localeCompare(b.label))
    .slice(0, SEARCH_MAX_RESULTS)
    .map(m => ({ id: m.id, label: m.label }))
}

// Every active member on the members tab (any member type): { id, name, label, words }.
// The label is "First L.", with more of the surname only when two people would look the same.
function memberDirectory_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheets().find(s => s.getSheetId() === MEMBERS_GID)
  if (!sheet) throw new Error('Members tab not found: gid=' + MEMBERS_GID)
  const values = sheet.getDataRange().getValues()
  const header = values[0].map(normalize_)
  const nameCol = header.indexOf(normalize_(MEMBERS_NAME_HEADER))
  const idCol = header.indexOf(normalize_(MEMBERS_ID_HEADER)) // optional
  const activeCol = header.indexOf(normalize_(MEMBERS_ACTIVE_HEADER)) // optional
  if (nameCol < 0) throw new Error('Members tab needs a "' + MEMBERS_NAME_HEADER + '" header in row 1')

  const seen = new Set()
  const members = values.slice(1)
    .filter(r => activeCol < 0 || !['false', 'no', 'n', 'inactive'].includes(normalize_(r[activeCol])))
    .map(r => {
      const name = String(r[nameCol]).trim()
      const memberId = idCol < 0 ? '' : String(r[idCol]).trim()
      return { name, id: memberId || nameId_(name), words: words_(name) }
    })
    .filter(m => m.name && m.words.length && !seen.has(m.id) && seen.add(m.id))

  // Shortest "First S..." label that no one else shares.
  members.forEach(m => {
    const parts = m.name.split(/\s+/)
    const first = parts[0], last = parts.length > 1 ? parts[parts.length - 1] : ''
    const labelFor = n => last ? first + ' ' + last.slice(0, n) + (n < last.length ? '.' : '') : first
    let n = 1
    while (last && n < last.length &&
      members.some(o => o !== m && o.words[0] === m.words[0] && o.words.length > 1 &&
        loose_(o.name.split(/\s+/).pop()).slice(0, n) === loose_(last).slice(0, n))) n++
    m.label = labelFor(n)
  })
  return members
}

// Stable id for a member without a Member ID, so the webpage never needs their full name.
function nameId_(name) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, normalize_(name))
  return 'n' + digest.slice(0, 6).map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('')
}
