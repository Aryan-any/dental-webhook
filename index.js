const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

const SHEET_ID = "1_ZjpP94PbhabE-68wBehhoLSZqhvKja4RkQ2oa2CJIU";

if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.error("FATAL: GOOGLE_SERVICE_ACCOUNT_JSON env var is missing");
  process.exit(1);
}

let credentials;
try {
  credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  console.log("Service account loaded:", credentials.client_email);
} catch (e) {
  console.error("FATAL: Could not parse GOOGLE_SERVICE_ACCOUNT_JSON:", e.message);
  process.exit(1);
}

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function normalizeDate(input) {
  if (!input) return "";
  const s = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];

  const months = {
    january:"01",february:"02",march:"03",april:"04",may:"05",june:"06",
    july:"07",august:"08",september:"09",october:"10",november:"11",december:"12",
    jan:"01",feb:"02",mar:"03",apr:"04",jun:"06",jul:"07",aug:"08",
    sep:"09",oct:"10",nov:"11",dec:"12"
  };
  const ordinals = {
    first:"01",second:"02",third:"03",fourth:"04",fifth:"05",sixth:"06",
    seventh:"07",eighth:"08",ninth:"09",tenth:"10",eleventh:"11",twelfth:"12",
    thirteenth:"13",fourteenth:"14",fifteenth:"15",sixteenth:"16",seventeenth:"17",
    eighteenth:"18",nineteenth:"19",twentieth:"20",twentyfirst:"21",
    twentysecond:"22",twentythird:"23",twentyfourth:"24",twentyfifth:"25",
    twentysixth:"26",twentyseventh:"27",twentyeighth:"28",twentyninth:"29",
    thirtieth:"30",thirtyfirst:"31"
  };
  const spokenYears = [
    [/nineteen\s+ninety\s+nine/,"1999"],[/nineteen\s+ninety\s+eight/,"1998"],
    [/nineteen\s+ninety\s+seven/,"1997"],[/nineteen\s+ninety\s+six/,"1996"],
    [/nineteen\s+ninety\s+five/,"1995"],[/nineteen\s+ninety\s+four/,"1994"],
    [/nineteen\s+ninety\s+three/,"1993"],[/nineteen\s+ninety\s+two/,"1992"],
    [/nineteen\s+ninety\s+one/,"1991"],[/nineteen\s+ninety/,"1990"],
    [/nineteen\s+eighty\s+nine/,"1989"],[/nineteen\s+eighty\s+eight/,"1988"],
    [/nineteen\s+eighty\s+five/,"1985"],[/nineteen\s+eighty/,"1980"],
    [/nineteen\s+seventy\s+eight/,"1978"],[/nineteen\s+seventy/,"1970"],
    [/nineteen\s+sixty\s+eight/,"1968"],[/nineteen\s+sixty/,"1960"],
    [/two\s+thousand\s+one/,"2001"],[/two\s+thousand/,"2000"],
  ];

  let lower = s.toLowerCase().replace(/[,\.]/g,"").replace(/\s+/g," ").trim();
  let year = null;
  const ym = lower.match(/\b(19|20)\d{2}\b/);
  if (ym) { year = ym[0]; lower = lower.replace(year,"").trim(); }
  if (!year) {
    for (const [re,val] of spokenYears) {
      if (re.test(lower)) { year=val; lower=lower.replace(re,"").trim(); break; }
    }
  }
  let month = null;
  for (const [name,val] of Object.entries(months)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) { month=val; lower=lower.replace(new RegExp(`\\b${name}\\b`),"").trim(); break; }
  }
  let day = null;
  lower = lower.replace(/(\d+)(st|nd|rd|th)/g,"$1");
  for (const [word,val] of Object.entries(ordinals)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) { day=val; lower=lower.replace(new RegExp(`\\b${word}\\b`),"").trim(); break; }
  }
  if (!day) { const dm = lower.match(/\b(\d{1,2})\b/); if (dm) day=dm[1].padStart(2,"0"); }
  if (year && month && day) { const r=`${year}-${month}-${day}`; console.log(`Date: "${input}" -> "${r}"`); return r; }
  console.log(`Could not normalize date: "${input}"`);
  return s;
}

app.get("/", (req, res) => res.json({ status: "OK", service_account: credentials.client_email }));

app.post("/lookup-patient", async (req, res) => {
  try {
    console.log("lookup-patient:", JSON.stringify(req.body));
    const { first_name, last_name, dob, phone } = req.body;
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const readRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "patients!A:H" });
    const rows = readRes.data.values || [];
    const fn = (first_name||"").toLowerCase().trim();
    const ln = (last_name||"").toLowerCase().trim();
    const dobClean = normalizeDate(dob||"");
    const phoneClean = (phone||"").replace(/\D/g,"");
    console.log(`Searching: "${fn} ${ln}" dob="${dobClean}" phone="${phoneClean}" rows=${rows.length-1}`);
    for (let i=1; i<rows.length; i++) {
      const row = rows[i];
      const rowFn=(row[1]||"").toLowerCase().trim();
      const rowLn=(row[2]||"").toLowerCase().trim();
      const rowDob=(row[3]||"").trim();
      const rowPhone=(row[4]||"").replace(/\D/g,"");
      const nameMatch=rowFn===fn&&rowLn===ln;
      const dobMatch=dobClean&&rowDob===dobClean;
      const phoneMatch=phoneClean&&rowPhone===phoneClean;
      console.log(`  Row${i}: "${rowFn} ${rowLn}" dob="${rowDob}" nameMatch=${nameMatch} dobMatch=${dobMatch} phoneMatch=${phoneMatch}`);
      if (nameMatch&&(dobMatch||phoneMatch)) {
        console.log("Found:", row[0]);
        return res.json({ found:true, patient_id:row[0], first_name:row[1], last_name:row[2], dob:row[3], phone:row[4], email:row[5], insurance:row[6], last_visit:row[7] });
      }
    }
    console.log("Not found");
    return res.json({ found: false });
  } catch (err) {
    console.error("lookup-patient error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/log-call", async (req, res) => {
  try {
    console.log("log-call:", JSON.stringify(req.body));
    const { patient_id, symptoms="", urgency="", appointment_type="", appointment_datetime="", notes="", call_duration_sec="" } = req.body;
    if (!patient_id) return res.status(400).json({ error: "patient_id required" });
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const readRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "patients!A:A" });
    const rows = readRes.data.values || [];
    let rowIdx = -1;
    for (let i=1; i<rows.length; i++) { if (rows[i][0]===patient_id) { rowIdx=i+1; break; } }
    if (rowIdx>0) {
      await sheets.spreadsheets.values.update({ spreadsheetId: SHEET_ID, range: `patients!I${rowIdx}:M${rowIdx}`, valueInputOption:"RAW", requestBody:{ values:[[symptoms,urgency,appointment_type,appointment_datetime,notes]] } });
    }
    const logRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "call_log!A:A" });
    const logRows = logRes.data.values||[];
    const logId = `LOG${String(logRows.length).padStart(4,"0")}`;
    let patientName="";
    if (rowIdx>0) {
      const nr = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `patients!B${rowIdx}:C${rowIdx}` });
      patientName=(nr.data.values?.[0]||[]).join(" ").trim();
    }
    await sheets.spreadsheets.values.append({ spreadsheetId: SHEET_ID, range: "call_log!A:L", valueInputOption:"RAW", requestBody:{ values:[[logId,new Date().toISOString(),patient_id,patientName,"Yes",symptoms,urgency,appointment_type,appointment_datetime,"",notes,call_duration_sec]] } });
    console.log("Logged:", logId);
    res.json({ success:true, patient_id, log_id:logId });
  } catch (err) {
    console.error("log-call error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT||3000;
app.listen(PORT, () => console.log(`Dental webhook running on port ${PORT}`));
