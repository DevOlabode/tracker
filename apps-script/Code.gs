const SPREADSHEET_ID = '1uxUdiJSHKYWBN_dVoiK1Aq85bhvFpKinjJexFWSFOqE'
const SHEET_GID = 1458779538 // the tab's gid from the URL (#gid=...)

function doPost(e) {
  try {
    console.log('doPost received: ' + (e && e.postData && e.postData.contents))

    const data = JSON.parse(e.postData.contents)
    const { type, name, location, date } = data

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

    sheet.appendRow([new Date(), type, name, location, date])
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
