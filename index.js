const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

// ── Convert any date format to YYYY-MM-DD ───────────────────────────────────
function normalizeDate(input) {
  if (!input) return "";
  const s = input.trim();

  // Already ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Try native Date parse (handles "April 12, 1990", "12/04/1990", etc.)
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split("T")[0];
  }

  // Handle spoken ordinals: "april twelfth nineteen ninety", "april 12th 1990"
  const months = {
    january:"01",february:"02",march:"03",april:"04",may:"05",june:"06",
    july:"07",august:"08",september:"09",october:"10",november:"11",december:"12",
    jan:"01",feb:"02",mar:"03",apr:"04",jun:"06",jul:"07",aug:"08",
    sep:"09",oct:"10",nov:"11",dec:"12"
  };
  const ordinals = {
    first:"1",second:"2",third:"3",fourth:"4",fifth:"5",sixth:"6",seventh:"7",
    eighth:"8",ninth:"9",tenth:"10",eleventh:"11",twelfth:"12",thirteenth:"13",
    fourteenth:"14",fifteenth:"15",sixteenth:"16",seventeenth:"17",eighteenth:"18",
    nineteenth:"19",twentieth:"20",twentyfirst:"21",twentysecond:"22",
    twentythird:"23",twentyfourth:"24",twentyfifth:"25",twentysixth:"26",
    twentyseventh:"27",twentyeighth:"28",twentyninth:"29",thirtieth:"30",
    thirtyfirst:"31"
  };
  const spokenYears = {
    "nineteen ninety":"1990","nineteen eighty":"1980","nineteen seventy":"1970",
    "nineteen sixty":"1960","nineteen fifty":"1950","two thousand":"2000",
    "nineteen ninety one":"1991","nineteen ninety two":"1992","nineteen ninety three":"1993",
    "nineteen ninety four":"1994","nineteen ninety five":"1995","nineteen ninety six":"1996",
    "nineteen ninety seven":"1997","nineteen ninety eight":"1998","nineteen ninety nine":"1999",
    "two thousand one":"2001","two thousand two":"2002","two thousand three":"2003",
    "two thousand four":"2004","two thousand five":"2005","two thousand six":"2006",
    "two thousand seven":"2007","two thousand eight":"2008","two thousand nine":"2009",
    "two thousand ten":"2010","two thousand eleven":"2011","two thousand twelve":"2012",
    "two thousand thirteen":"2013","two thousand fourteen":"2014","two thousand fifteen":"2015",
    "two thousand sixteen":"2016","two thousand seventeen":"2017","two thousand eighteen":"2018",
    "two thousand nineteen":"2019","two thousand twenty":"2020","two thousand twenty one":"2021",
    "two thousand twenty two":"2022","two thousand twenty three":"2023",
    "nineteen eighty five":"1985","nineteen eighty eight":"1988","nineteen eighty three":"1983",
    "nineteen seventy eight":"1978","nineteen sixty eight":"1968","nineteen sixty five":"1965",
  };

  let lower = s.toLowerCase().replace(/[,\.]/g, "").replace(/\s+/g, " ").trim();

  // Replace spoken year first
  let year = null;
  for (const [spoken, val] of Object.entries(spokenYears)) {
    if (lower.includes(spoken)) {
      year = val;
      lower = lower.replace(spoken, "").trim();
      break;
    }
  }
  // Fallback: 4-digit year in string
  if (!year) {
    const yearMatch = lower.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      year = yearMatch[0];
      lower = lower.replace(year, "").trim();
    }
  }

  // Find month
  let month = null;
  for (const [name, val] of Object.entries(months)) {
    if (lower.includes(name)) {
      month = val;
      lower = lower.replace(name, "").trim();
      break;
    }
  }

  // Find day — ordinal word first
  let day = null;
  // Remove "th", "st", "nd", "rd" suffixes from numbers
  lower = lower.replace(/(\d+)(st|nd|rd|th)/g, "$1");
  for (const [word, val] of Object.entries(ordinals)) {
    if (lower.includes(word)) {
      day = val.padStart(2, "0");
      lower = lower.replace(word, "").trim();
      break;
    }
  }
  // Fallback: number in remaining string
  if (!day) {
    const dayMatch = lower.match(/\b(\d{1,2})\b/);
    if (dayMatch) day = dayMatch[1].padStart(2, "0");
  }

  if (year && month && day) return `${year}-${month}-${day}`;

  return s; // return original if we couldn't parse
}

const SHEET_ID = "1_ZjpP94PbhabE-68wBehhoLSZqhvKja4RkQ2oa2CJIU";

// ── Auth via Service Account JSON from env ──────────────────────────────────
function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// ── Health check ────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.json({ status: "Dental Clinic Webhook OK" }));

// ── POST /log-call  — called by Feather at end of every call ────────────────
// Expected body:
// {
//   patient_id, symptoms, urgency, appointment_type,
//   appointment_datetime, notes, call_duration_sec
// }
app.post("/log-call", async (req, res) => {
  try {
    const {
      patient_id,
      symptoms = "",
      urgency = "",
      appointment_type = "",
      appointment_datetime = "",
      notes = "",
      call_duration_sec = "",
    } = req.body;

    if (!patient_id) {
      return res.status(400).json({ error: "patient_id is required" });
    }

    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // ── 1. Find the patient row in the patients sheet ──────────────────────
    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "patients!A:A",
    });

    const rows = readRes.data.values || [];
    let patientRowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === patient_id) {
        patientRowIndex = i + 1; // 1-indexed for Sheets API
        break;
      }
    }

    // ── 2. Update post-call columns I–M on the patient row ────────────────
    if (patientRowIndex > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `patients!I${patientRowIndex}:M${patientRowIndex}`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[symptoms, urgency, appointment_type, appointment_datetime, notes]],
        },
      });
    }

    // ── 3. Append to call_log sheet ────────────────────────────────────────
    const logRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "call_log!A:A",
    });
    const logRows = logRes.data.values || [];
    const nextLogId = `LOG${String(logRows.length).padStart(4, "0")}`;
    const timestamp = new Date().toISOString();

    // Get patient name from patients sheet for the log
    let patientName = "";
    if (patientRowIndex > 0) {
      const nameRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `patients!B${patientRowIndex}:C${patientRowIndex}`,
      });
      const nameRow = nameRes.data.values?.[0] || [];
      patientName = nameRow.join(" ").trim();
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: "call_log!A:L",
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          nextLogId,
          timestamp,
          patient_id,
          patientName,
          "Yes",              // verified — if we got here, they were verified
          symptoms,
          urgency,
          appointment_type,
          appointment_datetime,
          "",                 // slot_offered — optional
          notes,
          call_duration_sec,
        ]],
      },
    });

    console.log(`✅ Logged call for ${patient_id} (${patientName})`);
    res.json({ success: true, patient_id, log_id: nextLogId });

  } catch (err) {
    console.error("❌ log-call error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /lookup-patient — called by Feather during verification ─────────────
// Body: { first_name, last_name, dob }  OR  { first_name, last_name, phone }
app.post("/lookup-patient", async (req, res) => {
  try {
    const { first_name, last_name, dob, phone } = req.body;

    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: "patients!A:H",
    });

    const rows = readRes.data.values || [];
    // Row format: [patient_id, first_name, last_name, dob, phone, email, insurance, last_visit]

    const fn = (first_name || "").toLowerCase().trim();
    const ln = (last_name  || "").toLowerCase().trim();
    const dobClean   = normalizeDate(dob || "");
    console.log(`🔍 Lookup: "${fn} ${ln}" | dob raw="${dob}" → normalized="${dobClean}"`);
    const phoneClean = (phone || "").replace(/\D/g, ""); // digits only

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowFn    = (row[1] || "").toLowerCase().trim();
      const rowLn    = (row[2] || "").toLowerCase().trim();
      const rowDob   = (row[3] || "").trim();
      const rowPhone = (row[4] || "").replace(/\D/g, "");

      const nameMatch = rowFn === fn && rowLn === ln;
      const dobMatch  = dobClean   && rowDob   === dobClean;
      const phoneMatch= phoneClean && rowPhone === phoneClean;

      if (nameMatch && (dobMatch || phoneMatch)) {
        return res.json({
          found: true,
          patient_id:   row[0],
          first_name:   row[1],
          last_name:    row[2],
          dob:          row[3],
          phone:        row[4],
          email:        row[5],
          insurance:    row[6],
          last_visit:   row[7],
        });
      }
    }

    return res.json({ found: false });

  } catch (err) {
    console.error("❌ lookup-patient error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🦷 Dental webhook server running on port ${PORT}`));
